'use strict';

const { parseNUTResponse, parseStatusFlags, parseNUTErrors, NUT_ERROR_CATALOG } = require('../lib/nutParser');

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

// ── parseNUTErrors ──────────────────────────────────────────────────────────────

describe('parseNUTErrors', () => {

  test('returns an empty array when there are no ERR lines', () => {
    expect(parseNUTErrors('VAR ups battery.charge "90"\nOK Goodbye\n')).toEqual([]);
  });

  test('returns an empty array for empty/null/undefined buffers', () => {
    expect(parseNUTErrors('')).toEqual([]);
    expect(parseNUTErrors(null)).toEqual([]);
    expect(parseNUTErrors(undefined)).toEqual([]);
  });

  test('classifies DATA-STALE as stale-data and retryable, with guidance', () => {
    const [err] = parseNUTErrors('ERR DATA-STALE\n', { upsName: 'ups' });
    expect(err.code).toBe('DATA-STALE');
    expect(err.category).toBe('stale-data');
    expect(err.retryable).toBe(true);
    expect(err.guidance).toEqual(expect.stringContaining('ups'));
    expect(err.guidance.toLowerCase()).toEqual(expect.stringContaining('driver'));
  });

  test('classifies UNKNOWN-UPS as unknown-ups, not retryable, with guidance naming the UPS', () => {
    const [err] = parseNUTErrors('ERR UNKNOWN-UPS\n', { upsName: 'basement' });
    expect(err.category).toBe('unknown-ups');
    expect(err.retryable).toBe(false);
    expect(err.guidance).toEqual(expect.stringContaining('basement'));
    expect(err.guidance.toLowerCase()).toEqual(expect.stringContaining('case-sensitive'));
  });

  test('classifies ACCESS-DENIED as auth, not retryable, with guidance', () => {
    const [err] = parseNUTErrors('ERR ACCESS-DENIED\n', { upsName: 'ups' });
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.guidance).toBeTruthy();
  });

  test('classifies VAR-NOT-SUPPORTED as unsupported with no guidance', () => {
    const [err] = parseNUTErrors('ERR VAR-NOT-SUPPORTED\n', { upsName: 'ups' });
    expect(err.category).toBe('unsupported');
    expect(err.retryable).toBe(false);
    expect(err.guidance).toBeNull();
  });

  test('falls back to category "server", non-retryable, for an unrecognised code', () => {
    const [err] = parseNUTErrors('ERR SOME-FUTURE-CODE\n', { upsName: 'ups' });
    expect(err.code).toBe('SOME-FUTURE-CODE');
    expect(err.category).toBe('server');
    expect(err.retryable).toBe(false);
  });

  test('parses multiple ERR lines from one buffer, in order', () => {
    const buffer = 'ERR VAR-NOT-SUPPORTED\nERR DATA-STALE\n';
    const errors = parseNUTErrors(buffer, { upsName: 'ups' });
    expect(errors).toHaveLength(2);
    expect(errors[0].code).toBe('VAR-NOT-SUPPORTED');
    expect(errors[1].code).toBe('DATA-STALE');
  });

  test('ignores VAR and OK lines, only extracting ERR lines', () => {
    const buffer = 'OK\nVAR ups battery.charge "90"\nERR DATA-STALE\nOK Goodbye\n';
    expect(parseNUTErrors(buffer, { upsName: 'ups' })).toHaveLength(1);
  });

  test('works without a ctx argument (guidance functions tolerate a missing upsName)', () => {
    expect(() => parseNUTErrors('ERR DATA-STALE\n')).not.toThrow();
  });

  test('NUT_ERROR_CATALOG marks every "unsupported" entry as non-retryable with no guidance', () => {
    for (const [code, entry] of Object.entries(NUT_ERROR_CATALOG)) {
      if (entry.category === 'unsupported') {
        expect(entry.retryable).toBe(false);
        expect(entry.guidance({ upsName: 'ups' })).toBeNull();
      } else {
        // every non-'unsupported' catalog entry should have SOMETHING meaningful to say
        expect(entry.guidance({ upsName: code === 'no-ups' ? undefined : 'ups' })).toBeTruthy();
      }
    }
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
