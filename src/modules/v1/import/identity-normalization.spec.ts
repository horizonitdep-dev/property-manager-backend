import {
  buildingCodeComponents,
  normalizeEmiratesId,
  normalizeTradeLicense,
  normalizeUnitNumber,
  tenantMatchKey,
} from './identity-normalization';

describe('identity normalization', () => {
  it('treats a hyphenated and an unhyphenated Emirates ID as the same person', () => {
    // Real case: the DB holds "784199037801794" while extraction returns
    // "784-1990-37801794". Exact matching created a second tenant.
    expect(normalizeEmiratesId('784-1990-37801794')).toBe(normalizeEmiratesId('784199037801794'));
  });

  it('ignores trade licence punctuation', () => {
    expect(normalizeTradeLicense('CN-1234567')).toBe(normalizeTradeLicense('CN:1234567'));
    expect(normalizeTradeLicense('cn 1234567')).toBe('CN1234567');
  });

  it('keeps genuinely different numbers apart', () => {
    expect(normalizeEmiratesId('784-1990-1111111-1')).not.toBe(normalizeEmiratesId('784-1990-2222222-2'));
    // TN- and CN- are different licences, not formatting variants.
    expect(normalizeTradeLicense('TN-5916690')).not.toBe(normalizeTradeLicense('CN-5971916'));
  });

  it('collapses unit number spacing and case', () => {
    expect(normalizeUnitNumber('Show Room  4')).toBe('SHOW ROOM 4');
    expect(normalizeUnitNumber(' 101 ')).toBe('101');
  });

  it('splits a building code into its components', () => {
    expect(buildingCodeComponents('MZW16-R6')).toEqual(['MZW16', 'R6']);
    expect(buildingCodeComponents('R6')).toEqual(['R6']);
  });

  it('handles null and empty input without throwing', () => {
    expect(normalizeEmiratesId(null)).toBe('');
    expect(normalizeTradeLicense(undefined)).toBe('');
    expect(buildingCodeComponents(null)).toEqual([]);
  });

  describe('tenantMatchKey', () => {
    it('prefers trade licence, then Emirates ID, then name', () => {
      expect(tenantMatchKey({ tradeLicenseNumber: 'CN-1', emiratesIdNumber: '784', nameEn: 'X' })).toBe(
        'trade:CN1',
      );
      expect(tenantMatchKey({ emiratesIdNumber: '784-1990-1', nameEn: 'X' })).toBe('eid:78419901');
      expect(tenantMatchKey({ nameEn: 'Ahmed Al Mansoori' })).toBe('name:ahmed al mansoori');
    });

    it('gives one person the same key however their ID is written', () => {
      const a = tenantMatchKey({ emiratesIdNumber: '784-1990-3780179-4' });
      const b = tenantMatchKey({ emiratesIdNumber: '784199037801794' });

      expect(a).toBe(b);
    });
  });
});
