import apartmentIllustration from './assets/paper/apartment.svg';
import homicideIcon from './assets/paper/crime-categories/homicide.svg';
import sexualAssaultIcon from './assets/paper/crime-categories/sexual-assault.svg';
import robberyIcon from './assets/paper/crime-categories/robbery.svg';
import burglaryIcon from './assets/paper/crime-categories/burglary.svg';
import theftIcon from './assets/paper/crime-categories/theft.svg';
import motorVehicleTheftIcon from './assets/paper/crime-categories/motor-vehicle-theft.svg';
import arsonIcon from './assets/paper/crime-categories/arson.svg';
import deceptivePracticeIcon from './assets/paper/crime-categories/deceptive-practice.svg';
import assaultIcon from './assets/paper/crime-categories/assault.svg';
import batteryIcon from './assets/paper/crime-categories/battery.svg';
import stackMarkerIcon from './assets/icons/stack.svg';
import addApartmentIcon from './assets/icons/add-apartment.svg?raw';
import bookmarkIcon from './assets/icons/bookmark.svg?raw';
import calendarIcon from './assets/icons/calendar.svg?raw';
import checkCircleIcon from './assets/icons/check-circle.svg?raw';
import chevronRightIcon from './assets/icons/chevron-right.svg?raw';
import closeIcon from './assets/icons/close.svg?raw';
import deleteIcon from './assets/icons/delete.svg?raw';
import resetIcon from './assets/icons/reset.svg?raw';
import savedIcon from './assets/icons/saved.svg?raw';
import worthAVisitIcon from './assets/icons/worth-a-visit.svg?raw';

export { apartmentIllustration, stackMarkerIcon };

// Every icon except the crime categories is inline SVG, so it takes the
// colour of whatever surrounds it instead of needing one per context.
export const icons = {
  'add-apartment': addApartmentIcon,
  'bookmark': bookmarkIcon,
  'calendar': calendarIcon,
  'check-circle': checkCircleIcon,
  'chevron-right': chevronRightIcon,
  'trash-2': deleteIcon,
  'reset': resetIcon,
  'saved': savedIcon,
  'worth-a-visit': worthAVisitIcon,
  'x': closeIcon,
};

export const incidentIcons = {
  HOMICIDE: homicideIcon,
  'CRIMINAL SEXUAL ASSAULT': sexualAssaultIcon,
  'CRIM SEXUAL ASSAULT': sexualAssaultIcon,
  ROBBERY: robberyIcon,
  BURGLARY: burglaryIcon,
  THEFT: theftIcon,
  'MOTOR VEHICLE THEFT': motorVehicleTheftIcon,
  ARSON: arsonIcon,
  'DECEPTIVE PRACTICE': deceptivePracticeIcon,
  ASSAULT: assaultIcon,
  BATTERY: batteryIcon,
};

// The only "Primary Type" values the app keeps. Built from the icons, so a
// category can never reach the UI without one.
export const categories = Object.freeze(Object.keys(incidentIcons));