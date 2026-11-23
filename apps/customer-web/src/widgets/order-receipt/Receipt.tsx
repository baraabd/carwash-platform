import type { ReactNode } from 'react';
import { Icon } from '../../shared/Icon';
import { CarArt } from '../../shared/art/ReferenceArt';
import { NO_PLATE_TEXT, TECHNICIAN_NOTE_HEADING, type ReceiptView } from './receiptViewModel';
import './receipt.css';

interface ReceiptProps {
  readonly view: ReceiptView;
  /**
   * The control at the end of a line (0 vehicle … 5 payment): Review's «تعديل»;
   * nothing on a confirmed order. The technician note never has one.
   */
  readonly action?: (step: number) => ReactNode;
}

/**
 * The approved receipt markup (the reference's `summary()`). The page mounts
 * `ReferenceArtSprite` once for the car artwork.
 */
export function Receipt({ view, action }: ReceiptProps) {
  return (
    <div className="receipt">
      <div className="receipt-top">
        <CarArt art={view.vehicle.art} />
        <div className="grow">
          <h3>{view.vehicle.packageName}</h3>
          <p>{view.vehicle.carLine}</p>
          {view.vehicle.plate !== null ? (
            <span className="plate-mini" dir="auto">
              {view.vehicle.plate}
            </span>
          ) : (
            <small className="tiny muted">{NO_PLATE_TEXT}</small>
          )}
        </div>
        {action?.(0)}
      </div>
      <div className="receipt-line">
        <Icon name="spark" />
        <div className="grow">
          <strong>{view.care.packageName}</strong>
          <p>{view.care.extras}</p>
        </div>
        {action?.(1)}
      </div>
      <div className="receipt-line">
        <Icon name="pin" />
        <div className="grow">
          <strong>{view.place.label}</strong>
          <p>{view.place.address}</p>
          {view.place.accessNote !== null ? <p>{view.place.accessNote}</p> : null}
        </div>
        {action?.(2)}
      </div>
      <div className="receipt-line">
        <Icon name="calendar" />
        <div className="grow">
          <strong>{view.time.when}</strong>
          <p>{view.time.detail}</p>
        </div>
        {action?.(3)}
      </div>
      <div className="receipt-line">
        <Icon name="user" />
        <div className="grow">
          <strong>{view.contact.name}</strong>
          <p className="ltr">{view.contact.phone}</p>
        </div>
        {action?.(4)}
      </div>
      <div className="receipt-line">
        <Icon name={view.payment.icon} />
        <div className="grow">
          <strong>{view.payment.name}</strong>
          <p>{view.payment.detail}</p>
        </div>
        {action?.(5)}
      </div>
      {view.technicianNote !== null ? (
        <div className="receipt-line">
          <Icon name="message" />
          <div className="grow">
            <strong>{TECHNICIAN_NOTE_HEADING}</strong>
            <p>{view.technicianNote}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
