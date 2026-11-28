import { useState } from 'react';
import { Icon } from '../../../shared/Icon';
import { Price } from '../../../shared/Price';
import { Sheet } from '../../../shared/Sheet';
import { spawnTapWave } from '../../../shared/tapWave';
import type { HomePackageCard, HomePackageDetail } from '../homeViewModel';

interface HomePackagesProps {
  readonly packages: readonly HomePackageCard[];
  readonly details: readonly HomePackageDetail[];
  readonly onStartWithPackage: (id: string) => void;
  readonly unavailableReasonId?: string;
  readonly production?: boolean;
}

export function HomePackages({
  packages,
  details,
  onStartWithPackage,
  unavailableReasonId,
  production = false,
}: HomePackagesProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Choosing in the sheet starts the journey with that package, as the cards do.
  const choose = (id: string) => {
    if (unavailableReasonId !== undefined) return;
    setDetailsOpen(false);
    onStartWithPackage(id);
  };

  return (
    <>
      <div className="section-title">
        <div>
          <small>العناية تبدأ هنا</small>
          <h2>لكل يوم، غسلته.</h2>
        </div>
        <button
          className="text-btn"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setDetailsOpen(true)}
        >
          تفاصيل الباقات <Icon name="left" small />
        </button>
      </div>
      <div className="services-home">
        {packages.map((item) => (
          <button
            key={item.id}
            className={item.featured ? 'home-package featured' : 'home-package'}
            type="button"
            data-service={item.id}
            disabled={unavailableReasonId !== undefined}
            aria-describedby={unavailableReasonId}
            onClick={() => onStartWithPackage(item.id)}
          >
            <span className="package-icon">
              <Icon name={item.icon} />
            </span>
            <h3>{item.name}</h3>
            <p>{item.summary}</p>
            <span className="package-price">
              <span>{item.price === null ? 'السعر غير متاح' : <Price amount={item.price} />}</span>
              <Icon name="arrow" />
            </span>
          </button>
        ))}
      </div>
      <Sheet
        open={detailsOpen}
        title="لكل سيارة، عناية مناسبة."
        onClose={() => setDetailsOpen(false)}
      >
        <p className="sheet-intro">
          {production
            ? 'الباقات المنشورة. يظهر السعر لحجم سيارتك والإضافات قبل التأكيد.'
            : unavailableReasonId === undefined
              ? 'أرقام توضيحية للسيارة السيدان. يظهر فرق الحجم والإضافات قبل التأكيد.'
              : 'تفاصيل الباقات المنشورة. يحتاج تأكيد الحجز إلى عرض سعر وموعد متاح.'}
        </p>
        <div className="stack">
          {details.map((item) => (
            <div className="bill" style={{ margin: 0 }} key={item.id} data-package-detail={item.id}>
              <div className="row between">
                <h3>{item.name}</h3>
                <strong>
                  {item.price === null ? 'السعر غير متاح' : <Price amount={item.price} />}
                </strong>
              </div>
              <p className="input-note">
                {item.featuresLine}
                <br />
                {item.durationLine}
              </p>
              <button
                className="btn secondary full"
                type="button"
                onPointerDown={spawnTapWave}
                onClick={() => choose(item.id)}
                disabled={unavailableReasonId !== undefined}
                aria-describedby={unavailableReasonId}
              >
                اختيار هذه الباقة <Icon name="arrow" small />
              </button>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
