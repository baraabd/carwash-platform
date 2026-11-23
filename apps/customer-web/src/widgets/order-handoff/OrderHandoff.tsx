import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../shared/Icon';
import { Price } from '../../shared/Price';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { Receipt } from '../order-receipt/Receipt';
import {
  ORDER_NOT_FOUND_TEXT,
  ORDER_NOT_FOUND_TITLE,
  SESSION_ORDER_DISCLOSURE,
  WALLET_CHECKOUT_DEFERRED,
  buildOrderHandoffView,
  findSessionOrder,
  type HandoffKind,
} from './orderHandoffViewModel';
import './order-handoff.css';

/**
 * Post-confirmation handoff (C014) on the existing tracking and payment routes. It
 * resolves the order from the current session; an unknown id, or a link opened
 * after a reload (the session is in memory only), shows an explicit fallback.
 */
export function OrderHandoff({ kind }: { readonly kind: HandoffKind }) {
  const { orderId } = useParams();
  const { state } = useCustomerSession();
  const navigate = useNavigate();
  const order = findSessionOrder(state.orders, orderId);

  const home = (
    <button className="btn full" type="button" onClick={() => navigate('/')}>
      العودة إلى الرئيسية
    </button>
  );

  if (!order) {
    return (
      <section
        className="order-handoff"
        data-customer-route={kind}
        data-customer-fixture={`${kind}-default`}
        data-order-state="not-found"
      >
        <div className="page-heading">
          <div className="grow">
            <h1 tabIndex={-1}>{ORDER_NOT_FOUND_TITLE}</h1>
            <p>{ORDER_NOT_FOUND_TEXT}</p>
          </div>
        </div>
        {home}
      </section>
    );
  }

  const view = buildOrderHandoffView(order, kind);
  return (
    <section
      className="order-handoff"
      data-customer-route={kind}
      data-customer-fixture={`${kind}-default`}
      data-order-state={view.confirmed ? 'session-confirmed' : 'session-demo'}
    >
      <ReferenceArtSprite />
      <div className="page-heading">
        <div className="grow">
          <div className="eyebrow">طلب تجريبي</div>
          <h1 tabIndex={-1}>{view.title}</h1>
          <p>{SESSION_ORDER_DISCLOSURE}</p>
        </div>
      </div>
      {view.confirmed ? (
        <div className="order-status" role="status">
          <Icon name={view.confirmed.walletDeferred ? 'qr-pay' : 'banknote'} />
          <div className="grow">
            <strong>{view.confirmed.payment.label}</strong>
            <p>{view.confirmed.payment.hint}</p>
            {view.confirmed.walletDeferred ? <p>{WALLET_CHECKOUT_DEFERRED}</p> : null}
          </div>
          <strong className="order-amount">
            <Price amount={view.confirmed.total} />
          </strong>
        </div>
      ) : null}
      <Receipt view={view.receipt} />
      <p className="order-reference">
        مرجع الطلب في هذه الجلسة: <span className="ltr">{view.orderId}</span>
      </p>
      {home}
    </section>
  );
}
