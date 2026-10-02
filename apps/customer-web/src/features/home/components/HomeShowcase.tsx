import { Icon } from '../../../shared/Icon';
import { ExteriorSceneArt } from '../../../shared/art/ReferenceArt';

export function HomeBenefits() {
  return (
    <div className="benefits">
      <span>
        <Icon name="wallet" /> السعر من البداية
      </span>
      <span>
        <Icon name="calendar" /> الموعد باختيارك
      </span>
      <span>
        <Icon name="shield" /> بدون إنشاء حساب
      </span>
    </div>
  );
}

/** Entry to the payment walkthrough, which is owned by the payment-choice sprint (C012). */
export function PaymentPreviewLink() {
  return (
    <button className="pay-lab-link" type="button" aria-disabled="true" data-deferred-to="C012">
      <Icon name="wallet" />
      <span className="grow">
        <strong>جرّب الدفع بطريقتك.</strong>
        <small>كاش · شام كاش · سيريتل كاش — تجربة مباشرة</small>
      </span>
      <Icon name="arrow" />
    </button>
  );
}

/**
 * Before/after teaser. The artwork is an illustration, labelled as such; the
 * interactive comparison it opens is owned by the before/after sprint.
 */
export function ResultTeaser() {
  return (
    <>
      <div className="section-title">
        <h2>فرق تشوفه. وراحة تحسّها.</h2>
        <small>معاينة قبل وبعد</small>
      </div>
      <button
        className="result-teaser"
        type="button"
        aria-label="جرّب المقارنة التفاعلية قبل وبعد"
        aria-disabled="true"
        data-deferred-to="before-after"
      >
        <div className="teaser-scenes">
          <ExteriorSceneArt before={false} />
          <div className="teaser-mask">
            <ExteriorSceneArt before />
          </div>
          <span className="teaser-line" />
          <span className="teaser-tag">رسوم توضيحية</span>
        </div>
        <div className="teaser-bottom">
          <div>
            <strong>من قبل… إلى واو.</strong>
            <p>مقارنة تفاعلية، من أول نظرة لآخر لمعة.</p>
          </div>
          <Icon name="arrow" />
        </div>
      </button>
    </>
  );
}
