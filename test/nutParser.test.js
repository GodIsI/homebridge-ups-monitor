'use strict';

const { parseNUTResponse, parseStatusFlags } = require('../lib/nutParser');

// ── parseNUTResponse ──────────────────────────────────────────────────────────

describe('parseNUTResponse', () => {

  describe('single variable parsing', () => {
    test('parses a numeric float', () => {
      expect(parseNUTResponse('VAR ups input.voltage "230.5"\n'))
        .toEqual({ 'input.voltage': 230.5 });
    });

    test('parses an integer as a number', () => {
      expect(parseNUTResponse('VAR ups battery.charge "85"\n'))
        .toEqual({ 'battery.charge': 85 });
    });

    test('parses a string value', () => {
      expect(parseNUTResponse('VAR ups ups.status "OL"\n'))
        .toEqual({ 'ups.status': 'OL' });
    });

    test('parses a string value with spaces (model name)', () => {
      expect(parseNUTResponse('VAR ups ups.model "Smart-UPS 1500"\n'))
        .toEqual({ 'ups.model': 'Smart-UPS 1500' });
    });

    test('keeps an empty value as an empty string', () => {
      expect(parseNUTResponse('VAR ups ups.model ""\n'))
        .toEqual({ 'ups.model': '' });
    });
  });

  describe('multi-variable buffers', () => {
    test('parses multiple variables from one buffer', () => {
      const buffer = [
        'VAR ups input.voltage "230.5"',
        'VAR ups output.voltage "230.1"',
        'VAR ups battery.charge "85"',
        'VAR ups ups.status "OL CHRG"',
        'VAR ups ups.load "42"',
      ].join('\n');

      expect(parseNUTResponse(buffer)).toEqual({
        'input.voltage':  230.5,
        'output.voltage': 230.1,
        'battery.charge': 85,
        'ups.status':     'OL CHRG',
        'ups.load':       42,
      });
    });

    test('handles a full realistic NUT response', () => {
      const buffer = [
        'VAR ups ups.status "OL"',
        'VAR ups input.voltage "231.0"',
        'VAR ups input.voltage.nominal "230"',
        'VAR ups output.voltage "230.8"',
        'VAR ups battery.charge "100"',
        'VAR ups battery.charge.low "20"',
        'VAR ups battery.voltage "27.2"',
        'VAR ups ups.load "35"',
        'VAR ups battery.runtime "7200"',
        'VAR ups ups.model "Smart-UPS 1500"',
        'VAR ups ups.mfr "APC"',
        'OK Goodbye',
      ].join('\n');

      const result = parseNUTResponse(buffer);
      expect(result['ups.status']).toBe('OL');
      expect(result['input.voltage']).toBe(231.0);
      expect(result['battery.charge']).toBe(100);
      expect(result['ups.model']).toBe('Smart-UPS 1500');
      expect(result['ups.mfr']).toBe('APC');
    });
  });

  describe('noise and edge cases', () => {
    test('ignores OK lines', () => {
      expect(parseNUTResponse('OK\nVAR ups battery.charge "90"\nOK Goodbye\n'))
        .toEqual({ 'battery.charge': 90 });
    });

    test('ignores ERR lines', () => {
      expect(parseNUTResponse('ERR VAR-NOT-SUPPORTED\nVAR ups battery.charge "90"\n'))
        .toEqual({ 'battery.charge': 90 });
    });

    test('returns empty object for empty buffer', () => {
      expect(parseNUTResponse('')).toEqual({});
    });

    test('returns empty object when no VAR lines present', () => {
      expect(parseNUTResponse('OK\nERR ACCESS-DENIED\nOK Goodbye\n')).toEqual({});
    });

    test('handles null/undefined buffer gracefully', () => {
      expect(parseNUTResponse(null)).toEqual({});
      expect(parseNUTResponse(undefined)).toEqual({});
    });

    test('last value wins when variable appears twice', () => {
      const buffer = 'VAR ups battery.charge "50"\nVAR ups battery.charge "60"\n';
      expect(parseNUTResponse(buffer)['battery.charge']).toBe(60);
    });
  });

});

// ── parseStatusFlags ──────────────────────────────────────────────────────────

describe('parseStatusFlags', () => {

  describe('basic status tokens', () => {
    test('OL → onLine true, onBattery false', () => {
      const f = parseStatusFlags('OL');
      expect(f.onLine).toBe(true);
      expect(f.onBattery).toBe(false);
      expect(f.lowBattery).toBe(false);
    });

    test('OB → onBattery true, onLine false', () => {
      const f = parseStatusFlags('OB');
      expect(f.onLine).toBe(false);
      expect(f.onBattery).toBe(true);
    });

    test('OB LB → low battery flag set', () => {
      const f = parseStatusFlags('OB LB');
      expect(f.onBattery).toBe(true);
      expect(f.lowBattery).toBe(true);
    });
  });

  describe('charging / discharging flags', () => {
    test('OL CHRG → charging true', () => {
      const f = parseStatusFlags('OL CHRG');
      expect(f.charging).toBe(true);
      expect(f.discharging).toBe(false);
    });

    test('OL DISCHRG → discharging true, charging false', () => {
      const f = parseStatusFlags('OL DISCHRG');
      expect(f.charging).toBe(false);
      expect(f.discharging).toBe(true);
    });

    test('charging is false when DISCHRG is also present', () => {
      // Defensive: shouldn't happen in practice but guard the logic
      const f = parseStatusFlags('OL CHRG DISCHRG');
      expect(f.charging).toBe(false);
      expect(f.discharging).toBe(true);
    });
  });

  describe('raw field', () => {
    test('raw is the uppercased trimmed string', () => {
      expect(parseStatusFlags('ol chrg').raw).toBe('OL CHRG');
    });

    test('raw is empty string for empty input', () => {
      expect(parseStatusFlags('').raw).toBe('');
    });
  });

  describe('edge cases', () => {
    test('is case-insensitive', () => {
      expect(parseStatusFlags('ol').onLine).toBe(true);
      expect(parseStatusFlags('OB lb').lowBattery).toBe(true);
    });

    test('does not throw for empty string', () => {
      expect(() => parseStatusFlags('')).not.toThrow();
    });

    test('does not throw for null', () => {
      expect(() => parseStatusFlags(null)).not.toThrow();
    });

    test('does not throw for undefined', () => {
      expect(() => parseStatusFlags(undefined)).not.toThrow();
    });

    test('all flags are false for empty/null input', () => {
      const f = parseStatusFlags(null);
      expect(f.onLine).toBe(false);
      expect(f.onBattery).toBe(false);
      expect(f.lowBattery).toBe(false);
      expect(f.charging).toBe(false);
      expect(f.discharging).toBe(false);
    });
  });

});
