import { Icon } from '../../../shared/Icon';
import { CarArt } from '../../../shared/art/ReferenceArt';
import { spawnTapWave } from '../../../shared/tapWave';
import type { GarageCard } from '../garageViewModel';

interface GarageListProps {
  readonly cards: readonly GarageCard[];
  readonly onBook: (vehicleId: string) => void;
  readonly onEdit: (vehicleId: string) => void;
  readonly onDelete: (vehicleId: string) => void;
}

export function GarageList({ cards, onBook, onEdit, onDelete }: GarageListProps) {
  return (
    <>
      {cards.map((card) => (
        <article key={card.id} className="garage-card" data-vehicle-id={card.id}>
          <div className="row">
            <CarArt art={card.art} />
            <div className="grow">
              <h3>{card.name}</h3>
              <p>{card.description}</p>
              {card.plate ? (
                <span className="plate-mini" dir="auto">
                  {card.plate}
                </span>
              ) : (
                <p>اللوحة غير مضافة</p>
              )}
            </div>
          </div>
          <div className="garage-actions">
            <button
              className="btn secondary"
              type="button"
              onPointerDown={spawnTapWave}
              onClick={() => onBook(card.id)}
            >
              احجز لهذه السيارة
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label={`تعديل ${card.name}`}
              aria-haspopup="dialog"
              onPointerDown={spawnTapWave}
              onClick={() => onEdit(card.id)}
            >
              <Icon name="edit" small />
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label={`حذف ${card.name}`}
              aria-haspopup="dialog"
              onPointerDown={spawnTapWave}
              onClick={() => onDelete(card.id)}
            >
              <Icon name="trash" small />
            </button>
          </div>
        </article>
      ))}
    </>
  );
}

export function GarageEmpty() {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="car" />
      </div>
      <h2>مكان خاص لسيارتك.</h2>
      <p>
        أضف النوع واللوحة واللون مرة واحدة.
        <br />
        اللوحة اختيارية، وتساعد في تمييز السيارة.
      </p>
    </div>
  );
}
