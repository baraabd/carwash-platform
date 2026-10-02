import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { IllustrativeMapArt } from '../../../../shared/art/IllustrativeMapArt';
import { Icon } from '../../../../shared/Icon';
import {
  INITIAL_MAP_VIEW,
  MAP_DRAG_THRESHOLD,
  MAP_KEY_STEP,
  MAP_ZOOM_BUTTON_STEP,
  MAP_ZOOM_WHEEL_STEP,
  mapPointAt,
  panMapView,
  pinchMapView,
  zoomMapView,
  type MapView,
} from '../../../../state/locationStep';

interface IllustrativeMapProps {
  /** Where the pin is drawn, in the drawing's own 700×500 space. */
  readonly pin: { readonly x: number; readonly y: number };
  readonly locating: boolean;
  /** A tap on the drawing: put the pin there. */
  readonly onPoint: (x: number, y: number) => void;
  /** An arrow key: move the pin by this much. */
  readonly onNudge: (dx: number, dy: number) => void;
  readonly onLocate: () => void;
}

interface Gesture {
  readonly x: number;
  readonly y: number;
  readonly panX: number;
  readonly panY: number;
  moved: boolean;
}

const arrowSteps: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-MAP_KEY_STEP, 0],
  ArrowRight: [MAP_KEY_STEP, 0],
  ArrowUp: [0, -MAP_KEY_STEP],
  ArrowDown: [0, MAP_KEY_STEP],
};

const fromControl = (target: EventTarget) =>
  target instanceof Element && target.closest('button') !== null;

/**
 * The approved illustrative map: tap to place the pin, drag to pan, pinch,
 * Ctrl+wheel or the buttons to zoom, arrow keys to move the pin. Zoom and pan are
 * how the picture is looked at, so they live here and are forgotten with the sheet.
 */
export function IllustrativeMap({
  pin,
  locating,
  onPoint,
  onNudge,
  onLocate,
}: IllustrativeMapProps) {
  const [view, setView] = useState<MapView>(INITIAL_MAP_VIEW);
  // Gestures read the latest view synchronously, between renders.
  const viewRef = useRef(view);
  const map = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const hadPinch = useRef(false);

  const show = (next: MapView) => {
    viewRef.current = next;
    setView(next);
  };

  const pointerDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fromControl(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      hadPinch.current = false;
      gesture.current = {
        x: event.clientX,
        y: event.clientY,
        panX: viewRef.current.panX,
        panY: viewRef.current.panY,
        moved: false,
      };
    } else if (pointers.current.size === 2) {
      hadPinch.current = true;
      pinch.current = { distance: pointerDistance(), zoom: viewRef.current.zoom };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = gesture.current;
    if (pointers.current.size === 2 && pinch.current) {
      show(
        pinchMapView(
          viewRef.current,
          pinch.current.zoom,
          pinch.current.distance,
          pointerDistance(),
        ),
      );
    } else if (pointers.current.size === 1 && drag && !hadPinch.current) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > MAP_DRAG_THRESHOLD) drag.moved = true;
      if (drag.moved) show(panMapView(viewRef.current, drag.panX + dx, drag.panY + dy));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const drag = gesture.current;
    if (pointers.current.size === 1 && drag && !drag.moved && !hadPinch.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const point = mapPointAt(
        viewRef.current,
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      );
      onPoint(point.x, point.y);
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      pinch.current = null;
      hadPinch.current = false;
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    pinch.current = null;
    hadPinch.current = false;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (fromControl(event.target)) return;
    const step = arrowSteps[event.key];
    if (step) {
      event.preventDefault();
      onNudge(step[0], step[1]);
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      show(zoomMapView(viewRef.current, MAP_ZOOM_BUTTON_STEP));
    }
    if (event.key === '-') {
      event.preventDefault();
      show(zoomMapView(viewRef.current, -MAP_ZOOM_BUTTON_STEP));
    }
  };

  // Ctrl+wheel zooms the drawing instead of the page, which needs a non-passive
  // listener; a plain wheel is left alone so the sheet still scrolls.
  useEffect(() => {
    const element = map.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? MAP_ZOOM_WHEEL_STEP : -MAP_ZOOM_WHEEL_STEP;
      const next = zoomMapView(viewRef.current, delta);
      viewRef.current = next;
      setView(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      className="location-map"
      id="location-map"
      ref={map}
      tabIndex={0}
      role="group"
      aria-label="خريطة توضيحية. انقر لتحديد الدبوس، واسحب للتحريك. تدعم الأسهم والتكبير."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="map-world"
        id="map-world"
        style={{
          transform: `translate(-50%,-50%) translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`,
        }}
      >
        <IllustrativeMapArt />
        <div className="map-pin" id="map-pin" style={{ left: `${pin.x}px`, top: `${pin.y}px` }}>
          <svg viewBox="0 0 38 48" aria-hidden="true">
            <path
              d="M19 1C9 1 2 8 2 18c0 12 17 28 17 28s17-16 17-28C36 8 29 1 19 1Z"
              fill="#1d6042"
              stroke="white"
              strokeWidth="3"
            />
            <circle cx="19" cy="18" r="6" fill="#ddf8b4" />
          </svg>
        </div>
      </div>
      <div className="map-controls">
        <button
          type="button"
          aria-label="تكبير الخريطة"
          onClick={() => show(zoomMapView(viewRef.current, MAP_ZOOM_BUTTON_STEP))}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          aria-label="تصغير الخريطة"
          onClick={() => show(zoomMapView(viewRef.current, -MAP_ZOOM_BUTTON_STEP))}
        >
          <Icon name="minus" />
        </button>
      </div>
      <button type="button" className="map-location-button" disabled={locating} onClick={onLocate}>
        {locating ? (
          <>
            <span className="loading-dot" />
            جارٍ تحديد الموقع
          </>
        ) : (
          <>
            <Icon name="target" />
            موقعي الحالي
          </>
        )}
      </button>
      <span className="map-caption">خريطة توضيحية · ليست للملاحة</span>
    </div>
  );
}
