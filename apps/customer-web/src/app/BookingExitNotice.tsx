import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import { spawnTapWave } from '../shared/tapWave';
import { useCustomerSession } from '../state/CustomerSessionProvider';
import { pathForIntent } from '../state/navigationPath';
import { saveDraftAndExit } from '../state/vehicleStep';

/**
 * Booking header exit control and its approved confirmation sheet. The draft is
 * kept for this session only, which is what the sheet tells the customer.
 */
export function BookingExitNotice() {
  const [open, setOpen] = useState(false);
  const { run } = useCustomerSession();
  const navigate = useNavigate();

  const saveAndExit = () => {
    setOpen(false);
    const { intent } = run(saveDraftAndExit);
    if (intent) navigate(pathForIntent(intent));
  };

  return (
    <>
      <button
        className="icon-btn"
        type="button"
        aria-label="حفظ المسودة والخروج"
        aria-haspopup="dialog"
        onPointerDown={spawnTapWave}
        onClick={() => setOpen(true)}
      >
        <Icon name="close" />
      </button>
      <Sheet open={open} title="نكمل الغسلة لاحقًا؟" onClose={() => setOpen(false)}>
        <p className="sheet-intro">التخزين غير متاح. المسودة تبقى لهذه الجلسة فقط.</p>
        <button
          className="btn full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={saveAndExit}
        >
          حفظ والخروج
        </button>
        <button
          className="btn secondary full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={() => setOpen(false)}
        >
          متابعة الحجز
        </button>
      </Sheet>
    </>
  );
}
