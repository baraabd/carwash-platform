/**
 * The seven approved booking decisions, in order, with the label of the action
 * that leaves each one. Labels are the reference's FLOW; they must stay in step
 * with the route table (`app/routes.ts`), which a unit test enforces.
 */
export const bookingFlow = [
  { id: 'vehicle', label: 'السيارة', nextLabel: 'اختيار العناية' },
  { id: 'care', label: 'العناية', nextLabel: 'تحديد المكان' },
  { id: 'location', label: 'المكان', nextLabel: 'اختيار الموعد' },
  { id: 'time', label: 'الموعد', nextLabel: 'بيانات التواصل' },
  { id: 'contact', label: 'بياناتك', nextLabel: 'اختيار الدفع' },
  { id: 'payment', label: 'الدفع', nextLabel: 'مراجعة الحجز' },
  { id: 'review', label: 'التأكيد', nextLabel: 'تأكيد الحجز التجريبي' },
] as const;

export const BOOKING_FOOTER_SLOT_ID = 'booking-footer-slot';
