/**
 * PENDING OWNER DESIGN (TI-D03). The approved reference has no loading,
 * offline, unknown-outcome, conflict, error, unauthenticated or lost-task
 * state. These minimal texts are shown only through existing reference
 * components (the `#storage-warning` status bar, `#toast`) and must be
 * replaced by owner-approved copy. Every string here is listed in
 * docs/production/C/P03-C5-operator-web.md ("Production states pending owner design").
 */
export const PENDING = {
  loading: 'جارٍ تحميل المهام…',
  offline: 'لا يوجد اتصال الآن. تُعرض آخر حالة مؤكدة من الخادم.',
  unknown: 'لم يتأكد حفظ آخر إجراء بعد. ستُعاد المحاولة بالطلب نفسه عند عودة الاتصال.',
  unknownToast: 'لم يتأكد الحفظ بعد؛ لن يُعتبر ناجحًا قبل تأكيد الخادم.',
  auth: 'انتهت الجلسة أو لم يُسجّل الدخول. سجّل الدخول من جديد للمتابعة.',
  forbidden: 'هذا الحساب لا يملك صلاحية مهام الفني.',
  error: 'تعذّر تحميل البيانات من الخادم. أعد المحاولة لاحقًا.',
  conflict: 'تغيّرت المهمة على الخادم. عُرضت أحدث حالة؛ راجعها ثم أعد المحاولة.',
  lost: 'لم تعد هذه المهمة مسندة إليك. أُزيلت من قائمتك.',
  refused: 'رفض الخادم هذا الإجراء. عُرضت أحدث حالة للمهمة.',
  uploadRejected: 'رفض الخادم الصورة. التقط صورة أخرى.',
  bookingUnavailable: 'تفاصيل الطلب غير متاحة قبل استلام المهمة.',
  busy: 'انتظر اكتمال الإجراء السابق.',
} as const;
