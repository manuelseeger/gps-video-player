// All inputs are Unix UTC seconds. The manifest controls the display zone.
export class FlightClock {
  constructor(timeZone = 'UTC') {
    this.timeZone = timeZone;
    this.formatters = new Map();
    this.zoneFormatter = new Intl.DateTimeFormat('en-GB', {timeZone, timeZoneName:'shortOffset'});
  }
  format(seconds, decimals = 0) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) throw new RangeError('Invalid decimal count');
    if (!this.formatters.has(decimals)) this.formatters.set(decimals, new Intl.DateTimeFormat('en-GB', {timeZone:this.timeZone, hourCycle:'h23', hour:'2-digit', minute:'2-digit', second:'2-digit', ...(decimals ? {fractionalSecondDigits:decimals} : {})}));
    return this.formatters.get(decimals).format(new Date(Math.round(seconds * 1000)));
  }
  zoneLabel(seconds) {
    const date = new Date(Math.round(seconds * 1000));
    const offset = this.zoneFormatter.formatToParts(date).find(p => p.type === 'timeZoneName').value;
    return `${date.toISOString().slice(0, 10)} · ${this.timeZone} (${offset})`;
  }
}
