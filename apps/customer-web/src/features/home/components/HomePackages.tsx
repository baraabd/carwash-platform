import type { CarePackageId } from '../../../state/bookingDraft';
import { Icon } from '../../../shared/Icon';
import { Price } from '../../../shared/Price';
import type { HomePackageCard } from '../homeViewModel';

interface HomePackagesProps {
  readonly packages: readonly HomePackageCard[];
  readonly onStartWithPackage: (id: CarePackageId) => void;
}

export function HomePackages({ packages, onStartWithPackage }: HomePackagesProps) {
  return (
    <>
      <div className="section-title">
        <div>
          <small>العناية تبدأ هنا</small>
          <h2>لكل يوم، غسلته.</h2>
        </div>
        {/* The package-details sheet belongs to the service-packages sprint (C006). */}
        <button className="text-btn" type="button" aria-disabled="true" data-deferred-to="C006">
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
            onClick={() => onStartWithPackage(item.id)}
          >
            <span className="package-icon">
              <Icon name={item.icon} />
            </span>
            <h3>{item.name}</h3>
            <p>{item.summary}</p>
            <span className="package-price">
              <span>
                <Price amount={item.price} />
              </span>
              <Icon name="arrow" />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
