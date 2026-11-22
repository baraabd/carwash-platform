import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/Icon';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { announce, notify, type AddressSheetValues } from '../../state/locationStep';
import {
  blankAddressEditorValues,
  deleteSavedAddress,
  editorValuesForAddress,
  submitAccountAddress,
} from '../../state/savedAddresses';
import { AddressBookSheet, type AddressBookView } from './components/AddressBookSheet';
import { buildAccountViewModel, buildAddressBookItems, type AccountRow } from './accountViewModel';
import { CustomerProfileSheet } from '../../widgets/customer-access/CustomerProfileSheet';
import { ProductionNotice } from '../../widgets/customer-access/ProductionNotice';
import './account.css';

const DOCUMENT_TITLE = 'WashGo Signature — وقتك لك، واللمعة علينا';

/** Marks a control that is shown as approved but belongs to a later sprint. */
const deferred = { 'aria-disabled': true, 'data-deferred': 'account' } as const;

/**
 * The approved account screen. C009 owns its presentation and the saved-addresses
 * entry in parity. Production adds the canonical profile sheet and guest entry;
 * «سياراتي» uses the existing garage navigation. Other unfinished controls remain
 * visibly deferred.
 */
export function AccountRoute() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildAccountViewModel(state), [state]);
  const items = useMemo(() => buildAddressBookItems(state), [state]);
  const [book, setBook] = useState<AddressBookView | null>(null);
  const [editorSessions, setEditorSessions] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const openEditor = (addressId: string | null) => {
    const session = editorSessions + 1;
    setEditorSessions(session);
    setBook({ kind: 'editor', addressId, session });
  };

  const editingId = book?.kind === 'editor' ? book.addressId : null;
  const editing = state.addresses.find((record) => record.id === editingId);

  // Saves into the address book only. The booking draft and past orders are
  // separate copies and are not touched.
  const saveEditor = (values: AddressSheetValues) => {
    const result = run((current) => submitAccountAddress(current, values, editingId));
    if (result.error) return result.error;
    setBook({ kind: 'list' });
    return null;
  };

  const confirmDelete = (addressId: string) => {
    run((current) => ({ state: deleteSavedAddress(current, addressId) }));
    setBook({ kind: 'list' });
  };

  const activate = (row: AccountRow) => {
    if (row.action === 'profile') setProfileOpen(true);
    if (row.action === 'addresses') setBook({ kind: 'list' });
    if (row.action === 'garage') void navigate('/garage');
  };

  const renderRow = (row: AccountRow) => (
    <button
      key={row.id}
      className={row.danger ? 'settings-row danger' : 'settings-row'}
      type="button"
      data-account-row={row.id}
      aria-haspopup={row.action === 'addresses' || row.action === 'profile' ? 'dialog' : undefined}
      {...(row.action === 'deferred' ? deferred : {})}
      onClick={() => activate(row)}
    >
      <Icon name={row.icon} />
      <span className="grow">
        <strong>{row.title}</strong>
        <small>{row.hint}</small>
      </span>
      <Icon name="left" small />
    </button>
  );

  return (
    <div data-customer-route="account" data-customer-fixture="account-default">
      <div className="page-heading">
        <div className="grow">
          <div className="eyebrow">التفاصيل الصغيرة تصنع الفرق</div>
          <h1 tabIndex={-1}>حسابي.</h1>
          <p>
            {state.runtimeMode === 'parity'
              ? 'ملف محلي بسيط، دون كلمة مرور.'
              : 'بياناتك المحفوظة في الخدمة.'}
          </p>
        </div>
      </div>
      <div className="profile-hero">
        <div className="profile-avatar">{view.initial || <Icon name="user" />}</div>
        <div className="grow">
          <h2>{view.displayName}</h2>
          <p>
            {view.phone ? (
              <span className="ltr">{view.phone}</span>
            ) : state.runtimeMode === 'parity' ? (
              'بيانات تجريبية على جهازك'
            ) : (
              'لا يوجد رقم تواصل معروض'
            )}
          </p>
        </div>
        <button
          className="icon-btn"
          type="button"
          aria-label="تعديل بياناتي"
          {...(state.runtimeMode === 'parity'
            ? deferred
            : { 'aria-haspopup': 'dialog' as const, onClick: () => setProfileOpen(true) })}
        >
          <Icon name="edit" small />
        </button>
      </div>
      <div className="settings-group">{view.primaryRows.map(renderRow)}</div>
      <div className="settings-group">{view.secondaryRows.map(renderRow)}</div>
      <div className="info-note">
        <Icon name="info" />
        <span>
          {state.runtimeMode === 'parity' ? (
            <>
              النموذج محاكاة محلية. الأسعار والمواعيد والخريطة والرسوم لا تمثل خدمة حقيقية. عند ربط
              خادم، يلزم استكمال الأمان والتحقق والدفع والتشغيل.
            </>
          ) : state.productionData?.profileStatus === 'available' ? (
            'حفظ بيانات التواصل والسيارات مرتبط بجلسة المستخدم في الخدمة. تحديثها لا يغيّر بيانات الحجوزات السابقة.'
          ) : state.productionData?.profileStatus === 'anonymous' ? (
            'افتح بياناتي للمتابعة كضيف أو استعادة جلسة الضيف برمزك.'
          ) : (
            'تعذّر تحميل بيانات الحساب. حاول إعادة تحميل الصفحة.'
          )}
        </span>
      </div>
      <ProductionNotice />
      <p className="version">
        WashGo Signature · Payments Edition 06
        <br />
        تفصيلة واحدة. في كل خطوة.
      </p>
      <AddressBookSheet
        view={book}
        items={items}
        editorValues={editing ? editorValuesForAddress(editing) : blankAddressEditorValues()}
        onShow={setBook}
        onAdd={() => openEditor(null)}
        onEdit={openEditor}
        onSave={saveEditor}
        onConfirmDelete={confirmDelete}
        onNotice={(message) => run((current) => ({ state: notify(current, message) }))}
        onAnnounce={(message) => run((current) => ({ state: announce(current, message) }))}
        onClose={() => setBook(null)}
      />
      <CustomerProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
