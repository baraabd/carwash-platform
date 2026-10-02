import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { spawnTapWave } from '../../shared/tapWave';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { pathForIntent } from '../../state/navigationPath';
import {
  blankEditorValues,
  bookSavedVehicle,
  deleteSavedVehicle,
  editorValuesForVehicle,
  saveGarageVehicle,
  type VehicleEditorValues,
} from '../../state/savedVehicles';
import { VehicleEditorSheet } from '../../widgets/vehicle-editor/VehicleEditorSheet';
import { sizeName } from '../../widgets/vehicle-editor/vehicleEditorModel';
import { GarageEmpty, GarageList } from './components/GarageList';
import { buildGarageViewModel } from './garageViewModel';
import './garage.css';

const DOCUMENT_TITLE = 'WashGo Signature — وقتك لك، واللمعة علينا';

/** `null` adds a new car; an id edits that saved car. */
type EditorTarget = { readonly vehicleId: string | null };

export function GarageRoute() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildGarageViewModel(state), [state]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const editing = state.vehicles.find((vehicle) => vehicle.id === editor?.vehicleId);
  const deletingVehicle = state.vehicles.find((vehicle) => vehicle.id === deleting);

  const submitEditor = (values: VehicleEditorValues) => {
    const { error } = run((current) =>
      saveGarageVehicle(current, editor?.vehicleId ?? null, values, sizeName(values.type)),
    );
    if (!error) setEditor(null);
    return error;
  };

  const book = (vehicleId: string) => {
    const { intent } = run((current) => bookSavedVehicle(current, vehicleId));
    if (intent) navigate(pathForIntent(intent));
  };

  const confirmDelete = () => {
    if (deleting) run((current) => ({ state: deleteSavedVehicle(current, deleting) }));
    setDeleting(null);
  };

  return (
    <div data-customer-route="garage" data-customer-fixture="garage-default">
      <ReferenceArtSprite />
      <div className="page-heading">
        <div className="grow">
          <div className="eyebrow">أضفها مرة. واحجز براحتك.</div>
          <h1 tabIndex={-1}>سياراتي.</h1>
          <p>نوع السيارة ولوحتها وتفاصيلها، جاهزة للغسلة القادمة.</p>
        </div>
      </div>
      {view.empty ? (
        <GarageEmpty />
      ) : (
        <GarageList
          cards={view.cards}
          onBook={book}
          onEdit={(vehicleId) => setEditor({ vehicleId })}
          onDelete={setDeleting}
        />
      )}
      <button
        className={view.empty ? 'btn full gap-top' : 'btn outline full gap-top'}
        type="button"
        aria-haspopup="dialog"
        data-garage-action="add"
        onPointerDown={spawnTapWave}
        onClick={() => setEditor({ vehicleId: null })}
      >
        <Icon name="plus" small />
        إضافة سيارة
      </button>
      <p className="save-note">
        <Icon name="lock" /> الحفظ محلي، وليس حسابًا سحابيًا.
      </p>
      <VehicleEditorSheet
        open={editor !== null}
        formKey={editor?.vehicleId ?? 'new'}
        context="garage"
        initialValues={editing ? editorValuesForVehicle(editing) : blankEditorValues}
        choices={[]}
        onChoose={() => undefined}
        onStartNew={() => undefined}
        onSubmit={submitEditor}
        onClose={() => setEditor(null)}
      />
      <Sheet
        open={deletingVehicle !== undefined}
        title="حذف السيارة المحفوظة؟"
        onClose={() => setDeleting(null)}
      >
        <p className="sheet-intro">
          {`ستُحذف ${deletingVehicle?.name ?? ''} من سياراتك. تفاصيل الحجوزات السابقة تبقى كما كانت.`}
        </p>
        <button
          className="btn danger full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={confirmDelete}
        >
          حذف السيارة
        </button>
        <button
          className="btn secondary full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={() => setDeleting(null)}
        >
          رجوع
        </button>
      </Sheet>
    </div>
  );
}
