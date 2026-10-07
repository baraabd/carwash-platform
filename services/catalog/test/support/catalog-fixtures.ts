/**
 * TEST-ONLY definitions. The shape mirrors the approved journey (vehicle
 * category, package, add-ons) but none of these values is an approved business
 * definition and they must never be seeded into a real environment.
 */
export function definitionsFixture(): Record<string, unknown> {
  return {
    categories: [
      { id: 'suv', labelAr: 'كروس أوفر', labelEn: null, extraDurationMinutes: 10, sortOrder: 1 },
      { id: 'sedan', labelAr: 'سيدان', labelEn: 'Sedan', extraDurationMinutes: 0, sortOrder: 0 },
    ],
    addons: [
      {
        id: 'tyre-shine',
        labelAr: 'تلميع الإطارات',
        labelEn: null,
        durationMinutes: 10,
        sortOrder: 1,
        allowedCategoryIds: ['suv', 'sedan'],
      },
      {
        id: 'interior-fresh',
        labelAr: 'تعطير المقصورة',
        labelEn: null,
        durationMinutes: 5,
        sortOrder: 0,
        allowedCategoryIds: ['sedan'],
      },
    ],
    packages: [
      {
        id: 'full-care',
        labelAr: 'عناية كاملة',
        labelEn: null,
        descriptionAr: null,
        durationMinutes: 95,
        sortOrder: 1,
        featuresAr: ['تنظيف متكامل', 'عناية بالتفاصيل'],
        allowedCategoryIds: ['sedan', 'suv'],
        includedAddonIds: ['tyre-shine'],
        optionalAddonIds: [],
      },
      {
        id: 'exterior',
        labelAr: 'غسيل خارجي',
        labelEn: 'Exterior',
        descriptionAr: 'غسيل الهيكل والزجاج',
        durationMinutes: 35,
        sortOrder: 0,
        featuresAr: ['غسيل الهيكل', 'تنظيف الزجاج'],
        allowedCategoryIds: ['sedan', 'suv'],
        includedAddonIds: [],
        optionalAddonIds: ['tyre-shine', 'interior-fresh'],
      },
    ],
  };
}

export const ADMIN_SUBJECT = '1d8b2c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
export const CUSTOMER_SUBJECT = '2e9c3d5f-6071-4b8c-9dae-1f2a3b4c5d6e';
export const OTHER_ADMIN_SUBJECT = '3fad4e60-7182-4c9d-aebf-2a3b4c5d6e7f';
