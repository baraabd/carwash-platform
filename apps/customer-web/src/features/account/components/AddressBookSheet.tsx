import { Icon } from '../../../shared/Icon';
import { Sheet } from '../../../shared/Sheet';
import { spawnTapWave } from '../../../shared/tapWave';
import type { AddressSheetValues } from '../../../state/locationStep';
import {
  ADDRESS_EDITOR_TITLE,
  AddressEditorForm,
} from '../../../widgets/address-editor/AddressEditor';
import type { SavedAddressItem } from '../accountViewModel';

/**
 * Which view the one saved-addresses sheet is showing. `session` numbers the
 * editor openings so each one is a fresh editor, even for the same record.
 */
export type AddressBookView =
  | { readonly kind: 'list' }
  | { readonly kind: 'editor'; readonly addressId: string | null; readonly session: number }
  | { readonly kind: 'delete'; readonly addressId: string };

interface AddressBookSheetProps {
  /** Null while the sheet is closed. */
  readonly view: AddressBookView | null;
  readonly items: readonly SavedAddressItem[];
  /** Starting values for the editor view: a copy of the record, or blank. */
  readonly editorValues: AddressSheetValues;
  readonly onShow: (view: AddressBookView) => void;
  readonly onAdd: () => void;
  readonly onEdit: (addressId: string) => void;
  /** Saves the editor; returns the address message when the form is refused. */
  readonly onSave: (values: AddressSheetValues) => string | null;
  readonly onConfirmDelete: (addressId: string) => void;
  readonly onNotice: (message: string) => void;
  readonly onAnnounce: (message: string) => void;
  readonly onClose: () => void;
}

const titles = {
  list: 'عناويني المحفوظة',
  editor: ADDRESS_EDITOR_TITLE,
  delete: 'حذف هذا العنوان؟',
} as const;

/**
 * The approved address book: one sheet that moves between the list, the shared
 * address editor and the delete confirmation, as the reference does. Closing it
 * from any view discards whatever was not saved.
 */
export function AddressBookSheet({
  view,
  items,
  editorValues,
  onShow,
  onAdd,
  onEdit,
  onSave,
  onConfirmDelete,
  onNotice,
  onAnnounce,
  onClose,
}: AddressBookSheetProps) {
  const contentKey =
    view === null
      ? 'closed'
      : view.kind === 'editor'
        ? `editor-${view.session}`
        : view.kind === 'delete'
          ? `delete-${view.addressId}`
          : 'list';

  return (
    <Sheet
      open={view !== null}
      title={titles[view?.kind ?? 'list']}
      contentKey={contentKey}
      onClose={onClose}
    >
      {view?.kind === 'list' ? (
        <>
          {items.length > 0 ? (
            items.map((item) => (
              <div className="saved-item" key={item.id} data-saved-address={item.id}>
                <span className="soft-icon">
                  <Icon name="pin" />
                </span>
                <div className="grow">
                  <strong>{item.label}</strong>
                  <p>{item.address}</p>
                </div>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`تعديل ${item.label}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Icon name="edit" small />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`حذف ${item.label}`}
                  onClick={() => onShow({ kind: 'delete', addressId: item.id })}
                >
                  <Icon name="trash" small />
                </button>
              </div>
            ))
          ) : (
            <p className="sheet-intro">احفظ المكان مرة واحدة ليظهر في الحجز القادم.</p>
          )}
          <button
            className="btn full gap-top"
            type="button"
            onPointerDown={spawnTapWave}
            onClick={onAdd}
          >
            <Icon name="plus" small />
            إضافة عنوان
          </button>
        </>
      ) : null}
      {view?.kind === 'editor' ? (
        <AddressEditorForm
          key={view.session}
          context="account"
          initialValues={editorValues}
          onSubmit={onSave}
          onNotice={onNotice}
          onAnnounce={onAnnounce}
        />
      ) : null}
      {view?.kind === 'delete' ? (
        <>
          <p className="sheet-intro">لن يتغير عنوان أي حجز سابق.</p>
          <button
            className="btn danger full"
            type="button"
            onPointerDown={spawnTapWave}
            onClick={() => onConfirmDelete(view.addressId)}
          >
            حذف العنوان
          </button>
          <button
            className="btn secondary full"
            type="button"
            onPointerDown={spawnTapWave}
            onClick={() => onShow({ kind: 'list' })}
          >
            رجوع
          </button>
        </>
      ) : null}
    </Sheet>
  );
}
