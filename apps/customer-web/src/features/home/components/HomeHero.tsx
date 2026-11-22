import { Icon } from '../../../shared/Icon';
import { Price } from '../../../shared/Price';
import { CarArt } from '../../../shared/art/ReferenceArt';
import { spawnTapWave } from '../../../shared/tapWave';

interface HomeHeroProps {
  readonly greetingName: string | null;
  readonly carArt: 'sedan' | 'suv' | 'pickup';
  readonly startingPrice: number | null;
  readonly onStart: () => void;
  readonly unavailableReasonId?: string;
}

export function HomeHero({
  greetingName,
  carArt,
  startingPrice,
  onStart,
  unavailableReasonId,
}: HomeHeroProps) {
  return (
    <section className="hero signature-hero" aria-label="غسيل متنقل">
      <div className="row between">
        <span className="hero-tag">
          <Icon name="pin" /> على وقتك. عند بابك.
        </span>
        <span className="hero-index">WASHGO / SIGNATURE</span>
      </div>
      <div className="hero-copy">
        <p>{greetingName ? `أهلًا ${greetingName}. خذ راحتك.` : 'عناية أكثر. مجهود أقل.'}</p>
        <h1 tabIndex={-1}>
          وقتك لك.
          <br />
          <span>واللمعة علينا.</span>
        </h1>
      </div>
      <div className="hero-art">
        <CarArt art={carArt} />
        <span className="hero-spark a">
          <Icon name="spark" />
        </span>
        <span className="hero-spark b">
          <Icon name="spark" />
        </span>
      </div>
      <div className="hero-bottom">
        <div className="hero-price">
          غسلتك تبدأ من
          <strong>
            {startingPrice === null ? 'السعر غير متاح' : <Price amount={startingPrice} />}
          </strong>
        </div>
        <button
          className="hero-cta"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={onStart}
          disabled={unavailableReasonId !== undefined}
          aria-describedby={unavailableReasonId}
        >
          احجز غسلتك{' '}
          <span className="arrow-circle">
            <Icon name="arrow" />
          </span>
        </button>
      </div>
    </section>
  );
}
