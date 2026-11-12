import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const mock = fileURLToPath(new URL('./mapbox-mock.mjs', import.meta.url));
const csv = `ID,Date,Primary Type,Block,Latitude,Longitude
101,10/21/2026 12:00:00 PM,THEFT,001XX W TEST ST,41.8700,-87.6500
102,10/20/2026 12:00:00 PM,BATTERY,001XX W TEST ST,41.8700,-87.6500
103,10/19/2026 12:00:00 PM,THEFT,002XX W TEST ST,41.8750,-87.6485
108,10/18/2026 12:00:00 PM,THEFT,003XX W TEST ST,41.87360,-87.6500
109,10/17/2026 12:00:00 PM,THEFT,004XX W TEST ST,41.87364,-87.6500
111,10/16/2026 12:00:00 PM,THEFT,005XX W TEST ST,41.87723,-87.6500
112,10/15/2026 12:00:00 PM,THEFT,006XX W TEST ST,41.87725,-87.6500
104,10/14/2026 12:00:00 PM,THEFT,007XX W TEST ST,41.8900,-87.6500
105,10/13/2026 12:00:00 PM,THEFT,008XX W TEST ST,,-87.6500
106,10/12/2026 12:00:00 PM,CRIMINAL DAMAGE,009XX W TEST ST,41.8700,-87.6500
110,10/11/2026 12:00:00 PM,THEFT,010XX W TEST ST,41.8700,181
107,invalid,THEFT,006XX W TEST ST,41.8700,-87.6500
`;

test('CSV records, filters, and Mapbox GeoJSON stay in sync', { timeout: 60000 }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'chistay-mapping-'));
  let server;
  let browser;
  let page;
  const pageErrors = [];
  const externalRequests = [];
  try {
    server = await createServer({
      root,
      cacheDir,
      configFile: false,
      define: { 'import.meta.env.VITE_MAPBOX_TOKEN': JSON.stringify('pk.test') },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'mapping-test-fixtures',
        enforce: 'pre',
        resolveId(id) { if (id === 'mapbox-gl') return mock; },
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname !== '/Crimes_20261029.csv' || url.searchParams.has('url') || url.searchParams.has('import')) return next();
            response.setHeader('Content-Type', 'text/csv');
            response.end(csv);
          });
        },
      }],
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    page.on('response', response => {
      if (response.status() >= 400) pageErrors.push(`${response.status()} ${response.url()}`);
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(server.resolvedUrls.local[0]).origin) return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });
    await page.route('**/search/geocode/v6/forward?*', route => route.fulfill({
      json: { features: [{
        geometry: { coordinates: [-87.65, 41.87] },
        properties: { full_address: '1200 W Test St, Chicago, IL', context: { place: { name: 'Chicago' }, region: { region_code: 'IL' } } },
      }] },
    }));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('#overview-empty').waitFor({ state: 'visible' });
    await page.locator('.sidebar [data-action="add"]').click();
    await page.locator('#screen-verify').waitFor({ state: 'visible' });
    await page.locator('#address').fill('1200 W Test St, Chicago');
    await page.locator('#find-address').click();
    await page.locator('[data-action="explore"]').click();
    await page.locator('.record-row').first().waitFor();
    assert.equal(await page.evaluate(() => window.__testMap.options.cooperativeGestures), true);
    await page.waitForFunction(() => {
      const features = window.__testMap?.getSource('incidents')?.data.features;
      return features?.length && features.every(feature => feature.properties.icon);
    });

    const snapshot = () => page.evaluate(() => ({
      list: [...document.querySelectorAll('#record-list .record-row')].map(row => row.dataset.id),
      rows: [...document.querySelectorAll('#record-list .record-row')].map(row => ({
        id: row.dataset.id,
        category: row.querySelector('[data-field="category"]').textContent,
        block: row.querySelector('[data-field="block"]').textContent,
        date: row.querySelector('time').dateTime,
      })),
      features: window.__testMap.getSource('incidents').data.features.map(feature => ({ id: feature.properties.id, category: feature.properties.category, icon: feature.properties.icon, coordinates: feature.geometry.coordinates, stacked: feature.properties.stacked })),
      selected: window.__testMap.getSource('selected-incident').data.features.map(feature => ({ id: feature.properties.id, coordinates: feature.geometry.coordinates })),
    }));
    const expectedFeatures = {
      101: { id: '101', category: 'THEFT', icon: 'category-theft', coordinates: [-87.65, 41.87] },
      102: { id: '102', category: 'BATTERY', icon: 'category-battery', coordinates: [-87.65, 41.87] },
      103: { id: '103', category: 'THEFT', icon: 'category-theft', coordinates: [-87.6485, 41.875] },
      108: { id: '108', category: 'THEFT', icon: 'category-theft', coordinates: [-87.65, 41.87360] },
      109: { id: '109', category: 'THEFT', icon: 'category-theft', coordinates: [-87.65, 41.87364] },
      111: { id: '111', category: 'THEFT', icon: 'category-theft', coordinates: [-87.65, 41.87723] },
      112: { id: '112', category: 'THEFT', icon: 'category-theft', coordinates: [-87.65, 41.87725] },
    };
    const expectedRows = {
      101: { id: '101', category: 'Theft', block: '001xx W Test St', date: '2026-10-21' },
      102: { id: '102', category: 'Battery', block: '001xx W Test St', date: '2026-10-20' },
      103: { id: '103', category: 'Theft', block: '002xx W Test St', date: '2026-10-19' },
      108: { id: '108', category: 'Theft', block: '003xx W Test St', date: '2026-10-18' },
      109: { id: '109', category: 'Theft', block: '004xx W Test St', date: '2026-10-17' },
      111: { id: '111', category: 'Theft', block: '005xx W Test St', date: '2026-10-16' },
      112: { id: '112', category: 'Theft', block: '006xx W Test St', date: '2026-10-15' },
    };
    const expectRecords = async (ids, stacked = []) => {
      const current = await snapshot();
      assert.deepEqual(current.list, ids);
      assert.deepEqual(current.rows, ids.map(id => expectedRows[id]));
      assert.deepEqual(current.features, ids.map(id => ({ ...expectedFeatures[id], stacked: stacked.includes(id) })));
      return current;
    };

    const initialIds = ['101', '102', '103', '108', '109', '111'];
    let current = await expectRecords(initialIds, ['101', '102']);
    assert.deepEqual(current.selected, []);
    assert.equal(await page.locator('#category option[value="CRIMINAL DAMAGE"]').count(), 0);

    await page.evaluate(() => {
      const map = window.__testMap;
      const features = map.getSource('incidents').data.features.filter(feature => ['101', '102'].includes(feature.properties.id));
      map.handlers['click:incident-hit']({ features, lngLat: { lng: -87.65, lat: 41.87 } });
    });
    const stackedReports = page.locator('.stack-popup-row');
    assert.equal(await stackedReports.count(), 2);
    await stackedReports.nth(1).click();
    assert.equal(await page.locator('#detail-id').textContent(), '102');
    assert.equal(await page.locator('#detail-category').textContent(), 'Battery');
    assert.equal(await page.locator('#detail-block').textContent(), '001xx W Test St');
    assert.deepEqual((await snapshot()).selected, [{ id: '102', coordinates: [-87.65, 41.87] }]);
    await page.locator('[data-action="back-to-records"]').click();
    assert.deepEqual((await snapshot()).selected, []);

    await page.evaluate(() => {
      const map = window.__testMap;
      const feature = map.getSource('incidents').data.features.find(item => item.properties.id === '103');
      map.handlers['click:incident-hit']({ features: [feature] });
    });
    assert.equal(await page.locator('#detail-id').textContent(), '103');
    assert.deepEqual((await snapshot()).selected, [{ id: '103', coordinates: [-87.6485, 41.875] }]);
    await page.locator('[data-action="back-to-records"]').click();
    assert.deepEqual((await snapshot()).selected, []);

    await page.locator('#category').selectOption('THEFT');
    await expectRecords(['101', '103', '108', '109', '111']);

    await page.locator('[data-action="radius"][data-radius="0.25"]').click();
    assert.equal(await page.locator('#map-update-status').isVisible(), true);
    await page.evaluate(() => window.__testMap.handlers.render());
    assert.equal(await page.locator('#map-update-status').isVisible(), false);
    await expectRecords(['101', '108']);

    await page.locator('.record-row[data-id="108"]').click();
    current = await snapshot();
    assert.deepEqual(current.selected, [{ id: '108', coordinates: [-87.65, 41.87360] }]);
    await page.locator('#category').selectOption('BATTERY');
    current = await expectRecords(['102']);
    assert.deepEqual(current.selected, []);
    assert.equal(await page.locator('#records-list-view').isVisible(), true);

    await page.locator('.filters [data-action="reset"]').click();
    await expectRecords(initialIds, ['101', '102']);
    await page.locator('[data-action="radius"][data-radius="1"]').click();
    await expectRecords(['101', '102', '103', '108', '109', '111', '112'], ['101', '102']);

    await page.locator('#date-toggle').click();
    await page.locator('#date-month').selectOption('9');
    await page.locator('[data-day="2026-10-19"]').click();
    await page.locator('[data-day="2026-10-20"]').click();
    await expectRecords(['102', '103']);

    const saveDialog = page.locator('#save-dialog');
    await page.locator('#save-button').click();
    await page.waitForFunction(() => document.querySelector('#save-dialog').getAnimations().some(animation => animation.transitionProperty === 'opacity'));
    assert.equal(await saveDialog.evaluate(element => element.open), true);
    await page.locator('#save-dialog [data-action="close-dialog"]').click({ force: true });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#save-dialog')).display === 'none');

    await page.locator('#save-button').focus();
    await page.keyboard.press('Enter');
    assert.equal(await saveDialog.evaluate(element => element.open), true);
    assert.equal(await saveDialog.evaluate(element => element.getAnimations().length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await saveDialog.evaluate(element => element.open), false);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#save-button').click();
    assert.equal(await saveDialog.evaluate(element => element.open), true);
    assert.equal(await saveDialog.evaluate(element => element.getAnimations().length), 0);
    await page.locator('#save-dialog [data-action="close-dialog"]').click();
    assert.equal(await saveDialog.evaluate(element => getComputedStyle(element).display), 'none');

    await page.clock.install();
    await page.locator('#save-button').click();
    await page.locator('[data-action="save"][data-decision="worth"]').click();
    const toast = page.locator('#toast');
    assert.equal(await toast.isVisible(), true);
    await page.clock.fastForward(4000);
    assert.equal(await toast.isVisible(), true);

    await page.clock.fastForward(1000);
    assert.equal(await toast.evaluate(element => element.hidden), true);
    assert.equal(await toast.evaluate(element => element.getAnimations().length), 0);

    await page.locator('[data-action="overview"]').first().click();
    await page.locator('[data-action="open-apartment"]').click();
    await page.locator('#screen-explore').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#explore-address').textContent(), '1200 W Test St, Chicago, IL');
    await page.reload();
    await page.locator('[data-action="open-apartment"]').click();
    await page.locator('#screen-explore').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#explore-address').textContent(), '1200 W Test St, Chicago, IL');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await toast.evaluate(element => {
      element.classList.remove('is-expiring');
      element.hidden = false;
    });
    await page.clock.fastForward(300);
    await toast.evaluate(element => {
      element.classList.add('is-expiring');
      element.hidden = true;
    });
    await page.waitForFunction(() => document.querySelector('#toast').getAnimations().some(animation => animation.transitionProperty === 'opacity'));

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
  } catch (error) {
    throw new Error(`${error.message}\nBrowser errors: ${pageErrors.join('; ') || 'none'}`, { cause: error });
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});