import { useState } from 'react';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import { spawnTapWave } from '../shared/tapWave';

/** Header city control and the approved notice explaining it is illustrative. */
export function CityNotice() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="city" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="pin" /> دمشق <Icon name="down" />
      </button>
      <Sheet open={open} title="دمشق · مدينة النموذج" onClose={() => setOpen(false)}>
        <p className="sheet-intro">
          دمشق والليرة سورية هنا لإيضاح تجربة الاستخدام، وليسا إعلان توفر خدمة. الأسعار والمواعيد
          تجريبية، والخريطة ليست للملاحة.
        </p>
        <button
          className="btn full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={() => setOpen(false)}
        >
          متابعة التجربة
        </button>
      </Sheet>
    </>
  );
}
