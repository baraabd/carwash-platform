import type { Ref } from 'react';
import { Icon } from '../../../../shared/Icon';
import { CarArt } from '../../../../shared/art/ReferenceArt';
import type { VehicleTypeId } from '../../../../state/bookingDraft';
import type { VehicleOption } from '../vehicleViewModel';

interface VehicleStageProps {
  readonly art: VehicleOption['art'];
  readonly name: string;
  readonly plate: string;
  readonly stageRef: Ref<HTMLDivElement>;
}

/** Large preview of the chosen size with the live plate. */
export function VehicleStage({ art, name, plate, stageRef }: VehicleStageProps) {
  return (
    <div className="vehicle-stage" id="vehicle-stage" ref={stageRef}>
      <div className="stage-top">
        <span>YOUR CAR / YOUR CARE</span>
        <span>
          <Icon name="spark" small />
        </span>
      </div>
      <div className="stage-orbit" />
      <CarArt art={art} />
      <div className="stage-caption">
        <div>
          <strong id="stage-name">{name}</strong>
          <small>الحجم يحدد وقت العناية وسعرها</small>
        </div>
        <span className="plate-mini" id="stage-plate" dir="auto" hidden={!plate}>
          {plate}
        </span>
      </div>
    </div>
  );
}

interface VehicleTypeGridProps {
  readonly options: readonly VehicleOption[];
  readonly onSelect: (id: VehicleTypeId) => void;
}

/**
 * Native radios inside labels: one tab stop, arrow keys move the selection and
 * the checked state is exposed without any custom key handling.
 */
export function VehicleTypeGrid({ options, onSelect }: VehicleTypeGridProps) {
  return (
    <div className="signature-car-grid" role="radiogroup" aria-label="اختر حجم السيارة">
      {options.map((option) => (
        <label
          key={option.id}
          className={option.selected ? 'signature-car selected' : 'signature-car'}
          data-vehicle-type={option.id}
        >
          <input
            className="choice"
            type="radio"
            name="vehicleType"
            value={option.id}
            checked={option.selected}
            onChange={() => onSelect(option.id)}
          />
          <span className="radio-circle">
            {option.selected ? <Icon name="check" small /> : null}
          </span>
          <CarArt art={option.art} />
          <span className="car-label">
            <strong>{option.name}</strong>
            <small>{option.priceLabel}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
