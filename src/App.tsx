import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  COMPONENT_REGISTRY,
  POWER_RAILS,
  TERMINAL_OFFSET,
  createEmptyDiagram,
  getTerminals,
  isComponentKind,
  validateDiagram,
  wireEndpointPosition,
} from "./model";
import type { CircuitComponent, ComponentKind, Diagram, PowerMarker, PowerRail, TerminalId, Tool, Wire, WireEndpoint } from "./model";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };
const COMPONENT_ROTATIONS = [0, 90, 180, 270] as const;
const COMPONENT_DRAG_TYPE = "application/x-circuit-component";

function projectPointToSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { x: start.x + amount * dx, y: start.y + amount * dy };
}

function wireEndpointKey(endpoint: WireEndpoint): string {
  return "wireId" in endpoint
    ? JSON.stringify(["node", endpoint.wireId, endpoint.nodeId])
    : JSON.stringify(["terminal", endpoint.componentId, endpoint.terminal]);
}

function closestPointOnWire(
  diagram: Pick<Diagram, "components" | "wires">,
  wire: Wire,
  point: Point,
): { point: Point; segmentIndex: number } | undefined {
  const from = wireEndpointPosition(diagram, wire.from);
  const to = wireEndpointPosition(diagram, wire.to);
  if (!from || !to) return undefined;
  const points = [from, ...(wire.nodes ?? []), to];
  let nearestPoint = points[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  let segmentIndex = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const projected = projectPointToSegment(point, points[index], points[index + 1]);
    const distance = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = projected;
      segmentIndex = index;
    }
  }
  return { point: nearestPoint, segmentIndex };
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Icon({
  name,
  size = 18,
}: {
  name: "undo" | "redo" | "open" | "download" | "image" | "zoomIn" | "zoomOut" | "fit" | "cursor" | "wire" | "power" | "search" | "plus" | "minus" | "rotate";
  size?: number;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12h-2" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a6 6 0 0 0 0 12h2" /></>,
    open: <><path d="M3 7h5l2 2h11v10H3z" /><path d="M12 12v5m-2-2 2 2 2-2" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 19h16" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>,
    zoomIn: <><circle cx="10.8" cy="10.8" r="7" /><path d="m16 16 5 5M10.8 7.8v6m-3-3h6" /></>,
    zoomOut: <><circle cx="10.8" cy="10.8" r="7" /><path d="m16 16 5 5m-13.2-10h6" /></>,
    fit: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /><path d="M8 8h8v8H8z" /></>,
    cursor: <path d="m5 3 14 10-7 1-3 7z" />,
    wire: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h4a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3h0" /></>,
    power: <path d="m13 2-9 12h7l-1 8 10-13h-7z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    plus: <><path d="M12 5v14m-7-7h14" /></>,
    minus: <path d="M5 12h14" />,
    rotate: <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 1-2.34-5.66L20 9" /></>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function defaultLabel(type: CircuitComponent["type"], diagram: Diagram): string {
  const prefix = COMPONENT_REGISTRY[type].labelPrefix;
  const existing = diagram.components
    .filter((component) => COMPONENT_REGISTRY[component.type].labelPrefix === prefix)
    .map((component) => Number(component.label.match(/(\d+)$/)?.[1]))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...existing) + 1}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ComponentShape({
  component,
  selected,
  onPointerDown,
  onTerminalClick,
  wireMode,
  powerMode,
  onPowerTerminalClick,
  editingLabel,
  labelDraft,
  onLabelChange,
  onLabelCommit,
  onLabelCancel,
  onBeginLabelEdit,
}: {
  component: CircuitComponent;
  selected: boolean;
  onPointerDown: (event: PointerEvent<SVGGElement>, component: CircuitComponent) => void;
  onTerminalClick: (event: PointerEvent<SVGCircleElement>, component: CircuitComponent, terminal: TerminalId) => void;
  wireMode: boolean;
  powerMode: boolean;
  onPowerTerminalClick: (event: PointerEvent<SVGCircleElement>, component: CircuitComponent, terminal: TerminalId) => void;
  editingLabel: boolean;
  labelDraft: string;
  onLabelChange: (value: string) => void;
  onLabelCommit: (value: string) => void;
  onLabelCancel: () => void;
  onBeginLabelEdit: (component: CircuitComponent) => void;
}) {
  const color = COMPONENT_REGISTRY[component.type].color;
  const componentLabelY = component.type === "potentiometer"
    ? 72
    : component.type === "timer-555" ? 52
      : component.type === "qx5252f-to94" ? 52 : 34;
  return (
    <g
      className={`component ${selected ? "selected" : ""}`}
      transform={`translate(${component.x} ${component.y}) rotate(${component.rotation})`}
      onPointerDown={(event) => onPointerDown(event, component)}
      data-component-id={component.id}
    >
      {component.type === "esp32-c3-zero" ? (
        <g className="microcontroller-board">
          <rect className="board-hitbox" x="-70" y="-92" width="140" height="184" rx="12" />
          <rect className="board-usb" x="-24" y="-95" width="48" height="24" rx="5" />
          <text className="board-usb-label" x="0" y="-80" textAnchor="middle">USB-C</text>
          <text className="board-title" x="0" y="-55" textAnchor="middle">ESP32-C3-Zero</text>
          <rect className="board-chip" x="-34" y="-34" width="68" height="56" rx="5" />
          <text className="board-chip-label" x="0" y="-8" textAnchor="middle">ESP32-C3</text>
          <text className="board-chip-subtitle" x="0" y="7" textAnchor="middle">RISC-V · Wi-Fi · BLE</text>
          <text className="board-footer" x="0" y="68" textAnchor="middle">WAVESHARE</text>
        </g>
      ) : component.type === "timer-555" ? (
        <g className="timer-555">
          <rect className="component-hitbox" x="-40" y="-50" width="80" height="80" rx="8" />
          <rect className="timer-555-body" x="-40" y="-50" width="80" height="80" rx="7" />
          <path className="timer-555-notch" d="M-9 -50 A9 9 0 0 0 9 -50" />
          <circle className="timer-555-marker" cx="-28" cy="16" r="3" />
          {getTerminals("timer-555").map((pin) => (
            <line
              key={`pin-${pin.id}`}
              className="timer-555-pin"
              x1={pin.x}
              y1={pin.y}
              x2={pin.x < 0 ? pin.x + 12 : pin.x - 12}
              y2={pin.y}
            />
          ))}
          <text className="timer-555-number" x="0" y="-8" textAnchor="middle">555</text>
          <text className="timer-555-subtitle" x="0" y="9" textAnchor="middle">TIMER</text>
        </g>
      ) : component.type === "qx5252f-to94" ? (
        <g className="qx5252f-to94">
          <rect className="component-hitbox" x="-40" y="-30" width="80" height="50" rx="6" />
          <rect className="qx5252f-body" x="-40" y="-30" width="80" height="50" rx="6" />
          <text className="qx5252f-title" x="0" y="-4" textAnchor="middle">QX5252F</text>
          {getTerminals("qx5252f-to94").map((pin) => (
            <line
              key={`pin-${pin.id}`}
              className="qx5252f-pin"
              x1={pin.x}
              y1={pin.y}
              x2={pin.x}
              y2={pin.y - 7}
            />
          ))}
        </g>
      ) : component.type === "push-button" ? (
        <g className="push-button">
          <rect className="component-hitbox" x="-34" y="-32" width="68" height="58" rx="8" />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-14" y2="0" />
          <line className="lead" x1="14" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          <circle className="push-button-contact" cx="-14" cy="0" r="3" />
          <circle className="push-button-contact" cx="14" cy="0" r="3" />
          <path className="push-button-actuator" d="M-14 0 8-12V-25" />
          <line className="push-button-plunger" x1="-8" y1="-25" x2="24" y2="-25" />
        </g>
      ) : component.type === "power-supply" ? (
        <g className="power-supply">
          <rect className="component-hitbox" x="-34" y="-32" width="68" height="64" rx="12" />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-24" y2="0" />
          <line className="lead" x1="24" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          <circle className="power-supply-body" cx="0" cy="0" r="24" />
          <text className="power-supply-polarity" x="-10" y="5" textAnchor="middle">+</text>
          <text className="power-supply-polarity" x="10" y="5" textAnchor="middle">−</text>
        </g>
      ) : component.type === "inductor" ? (
        <g className="inductor">
          <rect className="component-hitbox" x="-34" y="-24" width="68" height="48" rx="8" />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-28" y2="0" />
          <line className="lead" x1="28" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          <path className="inductor-coil" d="M-28 0 C-28-14-14-14-14 0 C-14-14 0-14 0 0 C0-14 14-14 14 0 C14-14 28-14 28 0" />
        </g>
      ) : component.type === "rechargeable-battery" ? (
        <g className="rechargeable-battery">
          <rect className="component-hitbox" x="-34" y="-40" width="68" height="80" rx="8" />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-10" y2="0" />
          <line className="lead" x1="10" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          <line className="battery-plate battery-positive" x1="-10" y1="-18" x2="-10" y2="18" />
          <line className="battery-plate battery-negative" x1="10" y1="-11" x2="10" y2="11" />
          <text className="battery-polarity" x="-21" y="4" textAnchor="middle">+</text>
          <text className="battery-polarity" x="21" y="4" textAnchor="middle">−</text>
          <path className="battery-recharge" d="M-7-28a9 9 0 1 1 12 2m0-6v6H-1" />
        </g>
      ) : component.type === "solar-panel" ? (
        <g className="solar-panel">
          <rect className="component-hitbox" x="-34" y="-30" width="68" height="60" rx="8" />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-30" y2="0" />
          <line className="lead" x1="30" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          <rect className="solar-panel-body" x="-30" y="-22" width="60" height="44" rx="2" />
          <path className="solar-panel-grid" d="M-10-22v44M10-22v44M-30 0h60" />
          <path className="solar-panel-sun" d="M-12-29v-4m-7 7-3-3m17 3 3-3" />
        </g>
      ) : (
        <>
          <rect
            className="component-hitbox"
            x={component.type === "potentiometer" ? -34 : -32}
            y="-20"
            width={component.type === "potentiometer" ? 68 : 64}
            height={component.type === "potentiometer" ? 95 : 50}
          />
          <line className="lead" x1={-TERMINAL_OFFSET} y1="0" x2="-28" y2="0" />
          <line className="lead" x1="28" y1="0" x2={TERMINAL_OFFSET} y2="0" />
          {component.type === "resistor" || component.type === "potentiometer" ? (
            <path className="component-body resistor-body" d="M-28 0 -21 -10 -12 10 -3 -10 6 10 15 -10 22 10 28 0" />
          ) : component.type === "led" ? (
            <>
              <line className="component-body led-lead" x1="-28" y1="0" x2="-10" y2="0" />
              <path className="component-body led-body" d="M-10 -14 -10 14 12 0z" />
              <line className="component-body led-bar" x1="12" y1="-14" x2="12" y2="14" />
              <line className="component-body led-lead" x1="12" y1="0" x2="28" y2="0" />
              <path className="led-ray" d="M0 -18 8 -28m-3 0h3v3M10 -14 18 -24m-3 0h3v3" />
            </>
          ) : (
            <>
              <line className="component-body capacitor-lead" x1="-28" y1="0" x2="-5" y2="0" />
              <line className="component-body capacitor-plate" x1="-5" y1="-17" x2="-5" y2="17" />
              <line className="component-body capacitor-plate" x1="5" y1="-17" x2="5" y2="17" />
              <line className="component-body capacitor-lead" x1="5" y1="0" x2="28" y2="0" />
            </>
          )}
        </>
      )}
      {component.type === "potentiometer" && (
        <g className="potentiometer-wiper">
          <line className="pot-wiper-line" x1="0" y1={TERMINAL_OFFSET} x2="0" y2="16" />
          <path className="pot-wiper-arrow" d="m-6 23 6-8 6 8" />
        </g>
      )}
      {editingLabel ? (
        <foreignObject
          x="-48"
          y={componentLabelY - 13}
          width="96"
          height="30"
          transform={`rotate(${-component.rotation} 0 ${componentLabelY})`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            className="component-label-input"
            aria-label={`Edit label for ${component.label}`}
            autoFocus
            maxLength={32}
            value={labelDraft}
            onChange={(event) => onLabelChange(event.target.value)}
            onBlur={(event) => onLabelCommit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                onLabelCancel();
              }
            }}
          />
        </foreignObject>
      ) : (
        <text
          className="component-label"
          x="0"
          y={componentLabelY}
          textAnchor="middle"
          transform={`rotate(${-component.rotation} 0 ${componentLabelY})`}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onBeginLabelEdit(component);
          }}
        >
          <title>Double-click to edit label</title>
          {component.label}
        </text>
      )}
      {getTerminals(component.type).map((terminal) => {
        return (
          <g key={terminal.id}>
            {terminal.label && (
              <text
                className={component.type === "qx5252f-to94" ? "qx5252f-pin-label" : "board-pin-label"}
                x={component.type === "qx5252f-to94"
                  ? terminal.x
                  : terminal.x + (terminal.x < 0 ? -6 : 6)}
                y={component.type === "qx5252f-to94" ? terminal.y + 14 : terminal.y + 2.5}
                textAnchor={component.type === "qx5252f-to94"
                  ? "middle"
                  : terminal.x < 0 ? "end" : "start"}
              >
                <title>Physical pin {terminal.id}: {terminal.label}</title>
                {terminal.id} · {terminal.label}
              </text>
            )}
            <circle
              className={`terminal ${terminal.label ? "board-terminal" : ""} ${wireMode || powerMode ? "terminal-active" : ""}`}
              cx={terminal.x}
              cy={terminal.y}
              r={terminal.label ? 4 : 5}
              fill={color}
              onPointerDown={(event) => {
                if (wireMode) onTerminalClick(event, component, terminal.id);
                else if (powerMode) onPowerTerminalClick(event, component, terminal.id);
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

export default function App() {
  const [diagram, setDiagram] = useState<Diagram>(createEmptyDiagram);
  const [past, setPast] = useState<Diagram[]>([]);
  const [future, setFuture] = useState<Diagram[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [selectedPowerMarkerId, setSelectedPowerMarkerId] = useState<string | null>(null);
  const [powerRail, setPowerRail] = useState<PowerRail>("+5V");
  const [labelDraft, setLabelDraft] = useState("");
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [wireStart, setWireStart] = useState<WireEndpoint | null>(null);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const interaction = useRef<{
    kind: "pan" | "component" | "wire-node";
    pointerId: number;
    start: Point;
    origin: Point;
    componentId?: string;
    wireId?: string;
    nodeIndex?: number;
    originalDiagram?: Diagram;
  } | null>(null);

  const updateDiagram = useCallback((update: (current: Diagram) => Diagram) => {
    const next = update(diagram);
    if (next === diagram) return;
    setPast((items) => [...items.slice(-99), diagram]);
    setFuture([]);
    setDiagram(next);
  }, [diagram]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setPast(past.slice(0, -1));
    setFuture([diagram, ...future]);
    setDiagram(past[past.length - 1]);
    setWireStart(null);
    setSelectedPowerMarkerId(null);
  }, [diagram, future, past]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast([...past.slice(-99), diagram]);
    setDiagram(future[0]);
    setFuture(future.slice(1));
    setWireStart(null);
    setSelectedPowerMarkerId(null);
  }, [diagram, future, past]);

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
    };
  }, [viewport]);

  const snap = useCallback((value: number, gridSize: number, enabled: boolean) =>
    enabled ? Math.round(value / gridSize) * gridSize : value, []);

  const addComponent = useCallback((type: CircuitComponent["type"], point: Point) => {
    const component: CircuitComponent = {
      id: makeId(),
      type,
      x: snap(point.x, diagram.settings.gridSize, diagram.settings.snapToGrid),
      y: snap(point.y, diagram.settings.gridSize, diagram.settings.snapToGrid),
      rotation: 0,
      label: defaultLabel(type, diagram),
    };
    updateDiagram((current) => ({ ...current, components: [...current.components, component] }));
    setSelectedId(component.id);
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(null);
    setTool("select");
  }, [diagram, snap, updateDiagram]);

  const handleComponentDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    type: ComponentKind,
  ) => {
    event.dataTransfer.setData(COMPONENT_DRAG_TYPE, type);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleCanvasDragOver = (event: React.DragEvent<SVGSVGElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(COMPONENT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (event: React.DragEvent<SVGSVGElement>) => {
    const type = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);
    if (!isComponentKind(type)) return;
    event.preventDefault();
    addComponent(type, toWorld(event));
    setMessage(`${COMPONENT_REGISTRY[type].title} added.`);
  };

  const placePowerMarker = (
    event: { stopPropagation: () => void },
    endpoint: WireEndpoint,
  ) => {
    event.stopPropagation();
    const existing = diagram.powerMarkers.find((marker) =>
      wireEndpointKey(marker.endpoint) === wireEndpointKey(endpoint));
    if (existing) {
      setMessage(existing.rail === powerRail
        ? `${powerRail} is already marked at this point.`
        : `${existing.rail} is already marked at this point.`);
      return;
    }
    const marker: PowerMarker = { id: makeId(), rail: powerRail, endpoint };
    updateDiagram((current) => ({
      ...current,
      powerMarkers: [...current.powerMarkers, marker],
    }));
    setSelectedPowerMarkerId(null);
    setMessage(`Placed ${powerRail} power marker. Matching rail names share a net.`);
  };

  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("[data-component-id]")) return;
    const point = toWorld(event);
    if (tool !== "select" && tool !== "wire" && tool !== "power") {
      addComponent(tool, point);
      return;
    }
    if (tool === "power") {
      setSelectedId(null);
      setSelectedWireId(null);
      setSelectedNodeIndex(null);
      setSelectedPowerMarkerId(null);
      setMessage(`Click a component pin, wire node, or wire to place ${powerRail}.`);
      return;
    }
    setSelectedId(null);
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(null);
    setWireStart(null);
    if (tool === "select" || event.shiftKey) {
      interaction.current = {
        kind: "pan",
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: { x: viewport.x, y: viewport.y },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
  };

  const handleComponentPointerDown = (event: PointerEvent<SVGGElement>, component: CircuitComponent) => {
    if (tool !== "select" || event.button !== 0) return;
    event.stopPropagation();
    setSelectedId(component.id);
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(null);
    const point = toWorld(event);
    interaction.current = {
      kind: "component",
      pointerId: event.pointerId,
      start: point,
      origin: { x: component.x, y: component.y },
      componentId: component.id,
      originalDiagram: diagram,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handleWirePointerDown = (event: PointerEvent<SVGPolylineElement>, wire: Wire) => {
    if (event.button !== 0) return;
    if (tool === "power") {
      event.stopPropagation();
      const nearest = closestPointOnWire(diagram, wire, toWorld(event));
      if (!nearest) return;
      if ((wire.nodes?.length ?? 0) >= 128) {
        setMessage("A wire cannot have more than 128 bend nodes.");
        return;
      }
      const node = {
        id: makeId(),
        x: snap(nearest.point.x, diagram.settings.gridSize, diagram.settings.snapToGrid),
        y: snap(nearest.point.y, diagram.settings.gridSize, diagram.settings.snapToGrid),
      };
      const marker: PowerMarker = {
        id: makeId(),
        rail: powerRail,
        endpoint: { wireId: wire.id, nodeId: node.id },
      };
      updateDiagram((current) => ({
        ...current,
        wires: current.wires.map((item) => item.id === wire.id
          ? {
            ...item,
            nodes: [
              ...(item.nodes ?? []).slice(0, nearest.segmentIndex),
              node,
              ...(item.nodes ?? []).slice(nearest.segmentIndex),
            ],
          }
          : item),
        powerMarkers: [...current.powerMarkers, marker],
      }));
      setSelectedPowerMarkerId(null);
      setMessage(`Placed ${powerRail} marker on wire. Matching rail names share a net.`);
      return;
    }
    if (tool !== "select") return;
    event.stopPropagation();
    setSelectedId(null);
    setSelectedWireId(wire.id);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(null);
    setMessage("Wire selected. Double-click a segment to add a bend node.");
  };

  const handleWireDoubleClick = (event: React.MouseEvent<SVGPolylineElement>, wire: Wire) => {
    if (tool !== "select") return;
    event.stopPropagation();
    if ((wire.nodes?.length ?? 0) >= 128) {
      setMessage("A wire cannot have more than 128 bend nodes.");
      return;
    }
    const nearest = closestPointOnWire(diagram, wire, toWorld(event));
    if (!nearest) return;
    const node = {
      id: makeId(),
      x: snap(nearest.point.x, diagram.settings.gridSize, diagram.settings.snapToGrid),
      y: snap(nearest.point.y, diagram.settings.gridSize, diagram.settings.snapToGrid),
    };
    updateDiagram((current) => ({
      ...current,
      wires: current.wires.map((item) => item.id === wire.id
        ? {
          ...item,
          nodes: [
            ...(item.nodes ?? []).slice(0, nearest.segmentIndex),
            node,
            ...(item.nodes ?? []).slice(nearest.segmentIndex),
          ],
        }
        : item),
    }));
    setSelectedWireId(wire.id);
    setSelectedNodeIndex(nearest.segmentIndex);
    setMessage("Bend node added. Drag it to reshape the wire.");
  };

  const handleWireEndpointClick = (
    event: { stopPropagation: () => void },
    endpoint: WireEndpoint,
    description: string,
  ) => {
    event.stopPropagation();
    if (!wireStart) {
      setWireStart(endpoint);
      setMessage(`Choose a terminal or bend node to connect to ${description}.`);
      return;
    }
    if (wireEndpointKey(wireStart) === wireEndpointKey(endpoint)) {
      setWireStart(null);
      setMessage("Wire creation cancelled.");
      return;
    }
    const duplicate = diagram.wires.some((wire) =>
      (wireEndpointKey(wire.from) === wireEndpointKey(wireStart) &&
        wireEndpointKey(wire.to) === wireEndpointKey(endpoint)) ||
      (wireEndpointKey(wire.to) === wireEndpointKey(wireStart) &&
        wireEndpointKey(wire.from) === wireEndpointKey(endpoint)));
    if (duplicate) {
      setWireStart(null);
      setMessage("Those points are already connected.");
      return;
    }
    const wire: Wire = { id: makeId(), from: wireStart, to: endpoint };
    updateDiagram((current) => ({ ...current, wires: [...current.wires, wire] }));
    setWireStart(null);
    setMessage("Wire added.");
  };

  const handleWireNodePointerDown = (
    event: PointerEvent<SVGCircleElement>,
    wire: Wire,
    nodeIndex: number,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const node = wire.nodes?.[nodeIndex];
    if (!node) return;
    if (tool === "power") {
      placePowerMarker(event, { wireId: wire.id, nodeId: node.id });
      return;
    }
    if (tool === "wire") {
      handleWireEndpointClick(event, { wireId: wire.id, nodeId: node.id }, "wire bend node");
      return;
    }
    if (tool !== "select") return;
    setSelectedId(null);
    setSelectedWireId(wire.id);
    setSelectedNodeIndex(nodeIndex);
    setSelectedPowerMarkerId(null);
    interaction.current = {
      kind: "wire-node",
      pointerId: event.pointerId,
      start: toWorld(event),
      origin: node,
      wireId: wire.id,
      nodeIndex,
      originalDiagram: diagram,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handleTerminalClick = (
    event: PointerEvent<SVGCircleElement>,
    component: CircuitComponent,
    terminal: TerminalId,
  ) => {
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    handleWireEndpointClick(event, { componentId: component.id, terminal }, component.label);
  };

  const handlePowerTerminalClick = (
    event: PointerEvent<SVGCircleElement>,
    component: CircuitComponent,
    terminal: TerminalId,
  ) => {
    placePowerMarker(event, { componentId: component.id, terminal });
  };

  const handlePowerMarkerPointerDown = (
    event: PointerEvent<SVGGElement>,
    marker: PowerMarker,
  ) => {
    if (event.button !== 0) return;
    if (tool === "wire") {
      handleWireEndpointClick(event, marker.endpoint, `${marker.rail} power marker`);
      return;
    }
    if (tool === "power") {
      placePowerMarker(event, marker.endpoint);
      return;
    }
    if (tool !== "select") return;
    event.stopPropagation();
    setSelectedId(null);
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(marker.id);
    setMessage(`${marker.rail} power marker selected · Delete to remove.`);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "pan") {
      setViewport((current) => ({
        ...current,
        x: active.origin.x + event.clientX - active.start.x,
        y: active.origin.y + event.clientY - active.start.y,
      }));
      return;
    }
    const point = toWorld(event);
    if (active.kind === "wire-node") {
      const x = snap(active.origin.x + point.x - active.start.x, diagram.settings.gridSize, diagram.settings.snapToGrid);
      const y = snap(active.origin.y + point.y - active.start.y, diagram.settings.gridSize, diagram.settings.snapToGrid);
      setDiagram((current) => ({
        ...current,
        wires: current.wires.map((wire) => wire.id === active.wireId
          ? {
            ...wire,
            nodes: wire.nodes?.map((node, index) =>
              index === active.nodeIndex ? { ...node, x, y } : node),
          }
          : wire),
      }));
      return;
    }
    const x = snap(active.origin.x + point.x - active.start.x, diagram.settings.gridSize, diagram.settings.snapToGrid);
    const y = snap(active.origin.y + point.y - active.start.y, diagram.settings.gridSize, diagram.settings.snapToGrid);
    setDiagram((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.id === active.componentId ? { ...component, x, y } : component),
    }));
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!interaction.current || interaction.current.pointerId !== event.pointerId) return;
    const active = interaction.current;
    if (active.kind === "component") {
      const component = diagram.components.find((item) => item.id === active.componentId);
      if (component && (component.x !== active.origin.x || component.y !== active.origin.y)) {
        setPast((items) => [...items.slice(-99), active.originalDiagram ?? diagram]);
        setFuture([]);
      }
    } else if (active.kind === "wire-node") {
      const node = diagram.wires.find((wire) => wire.id === active.wireId)?.nodes?.[active.nodeIndex ?? -1];
      if (node && (node.x !== active.origin.x || node.y !== active.origin.y)) {
        setPast((items) => [...items.slice(-99), active.originalDiagram ?? diagram]);
        setFuture([]);
      }
    }
    interaction.current = null;
    setDragging(false);
  };

  const handleWheel = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    setViewport((current) => {
      const zoom = Math.min(3, Math.max(0.35, current.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
      const worldX = (localX - current.x) / current.zoom;
      const worldY = (localY - current.y) / current.zoom;
      return {
        zoom,
        x: localX - worldX * zoom,
        y: localY - worldY * zoom,
      };
    });
  }, []);

  useEffect(() => {
    const canvas = svgRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const deleteSelected = useCallback(() => {
    if (selectedPowerMarkerId) {
      updateDiagram((current) => ({
        ...current,
        powerMarkers: current.powerMarkers.filter((marker) => marker.id !== selectedPowerMarkerId),
      }));
      setSelectedPowerMarkerId(null);
      setMessage("Power marker removed.");
      return;
    }
    if (selectedWireId && selectedNodeIndex !== null) {
      const selectedNode = diagram.wires.find((wire) => wire.id === selectedWireId)
        ?.nodes?.[selectedNodeIndex];
      if (!selectedNode) return;
      const hasConnections = diagram.wires.some((wire) =>
        ("wireId" in wire.from && wire.from.wireId === selectedWireId && wire.from.nodeId === selectedNode.id) ||
        ("wireId" in wire.to && wire.to.wireId === selectedWireId && wire.to.nodeId === selectedNode.id)) ||
        diagram.powerMarkers.some((marker) =>
          "wireId" in marker.endpoint &&
          marker.endpoint.wireId === selectedWireId &&
          marker.endpoint.nodeId === selectedNode.id);
      if (hasConnections) {
        setMessage("This bend node has attached wires or power markers. Remove them first.");
        return;
      }
      updateDiagram((current) => ({
        ...current,
        wires: current.wires.map((wire) => wire.id === selectedWireId
          ? { ...wire, nodes: wire.nodes?.filter((node) => node.id !== selectedNode.id) }
          : wire),
      }));
      setSelectedNodeIndex(null);
      setMessage("Bend node removed.");
      return;
    }
    if (!selectedId) return;
    updateDiagram((current) => {
      const removedWireIds = new Set(current.wires
        .filter((wire) =>
          ("componentId" in wire.from && wire.from.componentId === selectedId) ||
          ("componentId" in wire.to && wire.to.componentId === selectedId))
        .map((wire) => wire.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const wire of current.wires) {
          if (removedWireIds.has(wire.id)) continue;
          if ([wire.from, wire.to].some((endpoint) =>
            "wireId" in endpoint && removedWireIds.has(endpoint.wireId))) {
            removedWireIds.add(wire.id);
            changed = true;
          }
        }
      }
      return {
        ...current,
        components: current.components.filter((component) => component.id !== selectedId),
        wires: current.wires.filter((wire) => !removedWireIds.has(wire.id)),
        powerMarkers: current.powerMarkers.filter((marker) =>
          !("componentId" in marker.endpoint && marker.endpoint.componentId === selectedId) &&
          !("wireId" in marker.endpoint && removedWireIds.has(marker.endpoint.wireId))),
      };
    });
    setSelectedId(null);
    setSelectedWireId(null);
    setSelectedNodeIndex(null);
    setSelectedPowerMarkerId(null);
  }, [diagram.powerMarkers, diagram.wires, selectedId, selectedNodeIndex, selectedPowerMarkerId, selectedWireId, updateDiagram]);

  const rotateSelected = useCallback(() => {
    if (!selectedId) return;
    updateDiagram((current) => ({
      ...current,
      components: current.components.map((component) => {
        if (component.id !== selectedId) return component;
        const rotationIndex = COMPONENT_ROTATIONS.indexOf(component.rotation);
        return {
          ...component,
          rotation: COMPONENT_ROTATIONS[(rotationIndex + 1) % COMPONENT_ROTATIONS.length],
        };
      }),
    }));
  }, [selectedId, updateDiagram]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      } else if (event.key === "Escape") {
        setWireStart(null);
        setSelectedWireId(null);
        setSelectedNodeIndex(null);
        setSelectedPowerMarkerId(null);
        setTool("select");
      } else if (event.key.toLowerCase() === "v") {
        setSelectedPowerMarkerId(null);
        setTool("select");
      } else if (event.key.toLowerCase() === "w") {
        setWireStart(null);
        setSelectedPowerMarkerId(null);
        setTool("wire");
      } else if (event.key.toLowerCase() === "p") {
        setWireStart(null);
        setSelectedPowerMarkerId(null);
        setTool("power");
        setMessage("Choose a rail, then click a component pin, wire node, or wire.");
      } else if (event.key.toLowerCase() === "r") {
        rotateSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, redo, rotateSelected, undo]);

  const openFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = validateDiagram(JSON.parse(text));
      setPast((items) => [...items.slice(-99), diagram]);
      setFuture([]);
      setDiagram(imported);
      setSelectedId(null);
      setSelectedWireId(null);
      setSelectedNodeIndex(null);
      setSelectedPowerMarkerId(null);
      setMessage(`Loaded ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the selected file.");
    }
  };

  const saveJson = () => {
    const json = JSON.stringify(diagram, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "circuit-diagram.json");
    setMessage("Diagram saved as JSON.");
  };

  const exportImage = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(svg.clientWidth * 2));
      clone.setAttribute("height", String(svg.clientHeight * 2));
      const exportStyles = document.createElementNS("http://www.w3.org/2000/svg", "style");
      exportStyles.textContent = `
        .canvas-background { fill: #f7f9fc; }
        .grid-dot { fill: #dce2eb; }
        .lead { stroke: #66717f; stroke-width: 2; }
        .component-body { fill: #fffaf1; stroke: #d9912d; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
        .capacitor-plate { fill: none; stroke: #4d79cb; stroke-width: 3; }
        .capacitor-lead { fill: none; stroke: #657181; stroke-width: 2; }
        .led-body { fill: #fdecec; stroke: #d9534f; stroke-width: 3; stroke-linejoin: round; }
        .led-bar { stroke: #d9534f; stroke-width: 3; stroke-linecap: round; }
        .led-lead { fill: none; stroke: #657181; stroke-width: 2; }
        .led-ray { fill: none; stroke: #d9534f; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
        .pot-wiper-line { stroke: #657181; stroke-width: 2; }
        .pot-wiper-arrow { fill: none; stroke: #b779c7; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
        .board-hitbox { fill: #2764a4; stroke: #194879; stroke-width: 2; }
        .board-usb { fill: #d8e0e9; stroke: #8290a1; stroke-width: 2; }
        .board-usb-label { fill: #47586d; font: 7px sans-serif; }
        .board-title { fill: #fff; font: 600 10px sans-serif; }
        .board-chip { fill: #172534; stroke: #53677b; stroke-width: 2; }
        .board-chip-label { fill: #f0f4f8; font: 700 10px sans-serif; }
        .board-chip-subtitle { fill: #a9bacb; font: 5px sans-serif; }
        .board-footer { fill: #d8e5f1; font: 600 7px sans-serif; letter-spacing: 1px; }
        .board-pin-label { fill: #42546a; font: 7px sans-serif; }
        .timer-555-body { fill: #536c8a; stroke: #364b65; stroke-width: 2; }
        .timer-555-notch { fill: none; stroke: #dbe5ef; stroke-width: 2; }
        .timer-555-marker { fill: #dbe5ef; }
        .timer-555-pin { stroke: #dbe5ef; stroke-width: 2; stroke-linecap: round; }
        .timer-555-number { fill: #fff; font: 700 17px sans-serif; letter-spacing: 1px; }
        .timer-555-subtitle { fill: #dbe5ef; font: 600 7px sans-serif; letter-spacing: 1px; }
        .qx5252f-body { fill: #536c8a; stroke: #364b65; stroke-width: 2; }
        .qx5252f-title { fill: #fff; font: 700 8px sans-serif; }
        .qx5252f-pin { stroke: #dbe5ef; stroke-width: 2; stroke-linecap: round; }
        .qx5252f-pin-label { fill: #42546a; font: 7px sans-serif; }
        .inductor-coil { fill: none; stroke: #a667b8; stroke-width: 3; stroke-linecap: round; }
        .battery-plate { stroke: #3d927b; stroke-width: 3; stroke-linecap: round; }
        .battery-polarity { fill: #28735f; font: 700 12px sans-serif; }
        .battery-recharge { fill: none; stroke: #3d927b; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .solar-panel-body { fill: #eaf2fc; stroke: #d89433; stroke-width: 2.5; }
        .solar-panel-grid { fill: none; stroke: #5482d4; stroke-width: 1.5; }
        .solar-panel-sun { fill: none; stroke: #d89433; stroke-width: 1.7; stroke-linecap: round; }
        .push-button-contact { fill: #fff; stroke: #4b9b86; stroke-width: 2; }
        .push-button-actuator { fill: none; stroke: #4b9b86; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
        .push-button-plunger { stroke: #4b9b86; stroke-width: 3; stroke-linecap: round; }
        .power-supply-body { fill: #eef8f3; stroke: #3d927b; stroke-width: 3; }
        .power-supply-polarity { fill: #28735f; font: 700 14px sans-serif; pointer-events: none; }
        .board-terminal { stroke: #e8f1fb; stroke-width: 1.5; }
        .component-label { fill: #717c8a; font: 11px sans-serif; }
        .wire-line { stroke: #718198; stroke-width: 2; stroke-linecap: round; }
        .wire-start-ring { fill: #4775d122; stroke: #4775d1; stroke-width: 2; }
        .power-marker-stem { stroke: #4775d1; stroke-width: 2; }
        .power-marker-label { fill: #edf3ff; stroke: #8ca9df; stroke-width: 1.5; }
        .power-marker-text { fill: #315da6; font: 700 8px sans-serif; }
        .terminal { stroke: #fff; stroke-width: 2; }
      `;
      clone.insertBefore(exportStyles, clone.firstChild);
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = svg.clientWidth * 2;
        canvas.height = svg.clientHeight * 2;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          setMessage("Image export failed: canvas rendering is unavailable.");
          return;
        }
        context.fillStyle = "#f7f9fc";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((png) => {
          URL.revokeObjectURL(url);
          if (png) {
            downloadBlob(png, "circuit-diagram.png");
            setMessage("Diagram exported as PNG.");
          } else setMessage("Image export failed while creating the PNG file.");
        }, "image/png");
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        setMessage("Image export failed while rendering the diagram.");
      };
      image.src = url;
    } catch (error) {
      setMessage(error instanceof Error ? `Image export failed: ${error.message}` : "Image export failed.");
    }
  };

  const changeGridSize = (amount: number) => {
    updateDiagram((current) => ({
      ...current,
      settings: { ...current.settings, gridSize: Math.min(100, Math.max(5, current.settings.gridSize + amount)) },
    }));
  };

  const setZoom = (zoom: number) => {
    const svg = svgRef.current;
    const width = svg?.clientWidth ?? window.innerWidth;
    const height = svg?.clientHeight ?? window.innerHeight;
    setViewport((current) => {
      const nextZoom = Math.min(3, Math.max(0.35, zoom));
      const worldX = (width / 2 - current.x) / current.zoom;
      const worldY = (height / 2 - current.y) / current.zoom;
      return { zoom: nextZoom, x: width / 2 - worldX * nextZoom, y: height / 2 - worldY * nextZoom };
    });
  };

  const fitView = () => {
    if (!diagram.components.length) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const bounds = diagram.components.reduce(
      (value, component) => {
        const isBoard = component.type === "esp32-c3-zero";
        const isPotentiometer = component.type === "potentiometer";
        const is555Timer = component.type === "timer-555";
        const isQx5252f = component.type === "qx5252f-to94";
        const halfWidth = isBoard
          ? (component.rotation % 180 === 0 ? 150 : 100)
          : is555Timer
            ? (component.rotation % 180 === 0 ? 130 : 95)
            : isQx5252f
              ? (component.rotation % 180 === 0 ? 60 : 65)
              : isPotentiometer && component.rotation % 180 !== 0 ? 90 : 75;
        const halfHeight = isBoard
          ? (component.rotation % 180 === 0 ? 100 : 150)
          : is555Timer
            ? (component.rotation % 180 === 0 ? 95 : 130)
            : isQx5252f
              ? (component.rotation % 180 === 0 ? 65 : 60)
              : isPotentiometer && component.rotation % 180 === 0 ? 90 : 50;
        return {
          minX: Math.min(value.minX, component.x - halfWidth),
          minY: Math.min(value.minY, component.y - halfHeight),
          maxX: Math.max(value.maxX, component.x + halfWidth),
          maxY: Math.max(value.maxY, component.y + halfHeight),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const zoom = Math.min(2, Math.max(0.35,
      Math.min((rect.width - 100) / (bounds.maxX - bounds.minX), (rect.height - 100) / (bounds.maxY - bounds.minY))));
    setViewport({
      zoom,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    });
  };

  const filteredComponents = useMemo(() =>
    (Object.keys(COMPONENT_REGISTRY) as CircuitComponent["type"][]).filter((type) =>
      `${COMPONENT_REGISTRY[type].title} ${COMPONENT_REGISTRY[type].description}`.toLowerCase().includes(query.toLowerCase())),
  [query]);

  const selectedComponent = diagram.components.find((component) => component.id === selectedId);

  useEffect(() => {
    setLabelDraft(selectedComponent?.label ?? "");
  }, [selectedComponent?.id, selectedComponent?.label]);

  const commitLabel = (draft = labelDraft) => {
    if (!selectedComponent) return;
    const label = draft.trim();
    if (!label) {
      setLabelDraft(selectedComponent.label);
      setMessage("A component label cannot be empty.");
      return;
    }
    if (label !== selectedComponent.label) {
      updateDiagram((current) => ({
        ...current,
        components: current.components.map((component) =>
          component.id === selectedComponent.id ? { ...component, label } : component),
      }));
      setMessage(`Label changed to ${label}.`);
    }
    setLabelDraft(label);
  };

  const beginLabelEdit = (component: CircuitComponent) => {
    setSelectedId(component.id);
    setLabelDraft(component.label);
    setEditingLabelId(component.id);
  };

  const wireLines = diagram.wires.map((wire) => {
    const from = wireEndpointPosition(diagram, wire.from);
    const to = wireEndpointPosition(diagram, wire.to);
    if (!from || !to) return null;
    const nodes = wire.nodes ?? [];
    const points = [from, ...nodes, to].map((point) => `${point.x},${point.y}`).join(" ");
    const selected = wire.id === selectedWireId;
    return (
      <g key={wire.id}>
        <polyline
          className="wire-hitbox"
          points={points}
          onPointerDown={(event) => handleWirePointerDown(event, wire)}
          onDoubleClick={(event) => handleWireDoubleClick(event, wire)}
        />
        <polyline className={`wire-line${selected ? " selected-wire" : ""}`} points={points} />
      </g>
    );
  });
  const wireNodeHandles = diagram.wires.flatMap((wire) => {
    const selected = wire.id === selectedWireId;
    if (!selected && tool !== "wire" && tool !== "power") return [];
    return (wire.nodes ?? []).map((node, index) => {
      const isJunction = diagram.wires.some((connection) =>
        connection.id !== wire.id &&
        [connection.from, connection.to].some((endpoint) =>
          "wireId" in endpoint && endpoint.wireId === wire.id && endpoint.nodeId === node.id));
      return (
        <circle
          key={node.id}
          className={`wire-node${isJunction ? " wire-junction" : ""}${selected && index === selectedNodeIndex ? " selected-wire-node" : ""}`}
          cx={node.x}
          cy={node.y}
          r={isJunction ? "6" : "5"}
          aria-label={`Wire bend node ${index + 1}`}
          onPointerDown={(event) => handleWireNodePointerDown(event, wire, index)}
        />
      );
    });
  });
  const powerMarkerElements = diagram.powerMarkers.map((marker) => {
    const endpoint = marker.endpoint;
    const anchor = wireEndpointPosition(diagram, endpoint);
    if (!anchor) return null;
    let labelX = 8;
    let labelY = -31;
    let stemX = 0;
    let stemY = -14;
    let textX = 29;
    let textY = -20;
    if ("componentId" in endpoint) {
      const component = diagram.components.find((item) => item.id === endpoint.componentId);
      if (component) {
        const dx = anchor.x - component.x;
        const dy = anchor.y - component.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          labelX = dx < 0 ? -50 : 8;
          labelY = -8;
          stemX = dx < 0 ? -8 : 8;
          stemY = 0;
          textX = labelX + 21;
          textY = 3;
        } else {
          labelX = -13;
          labelY = dy < 0 ? -34 : 16;
          stemX = 0;
          stemY = dy < 0 ? -8 : 8;
          textX = 8;
          textY = labelY + 11;
        }
      }
    }
    const selected = marker.id === selectedPowerMarkerId;
    return (
      <g
        key={marker.id}
        className={`power-marker${selected ? " power-marker-selected" : ""}`}
        transform={`translate(${anchor.x} ${anchor.y})`}
        onPointerDown={(event) => handlePowerMarkerPointerDown(event, marker)}
      >
        <title>{marker.rail} power net</title>
        <line className="power-marker-stem" x1="0" y1="0" x2={stemX} y2={stemY} />
        <rect className="power-marker-label" x={labelX} y={labelY} width="42" height="17" rx="4" />
        <text className="power-marker-text" x={textX} y={textY} textAnchor="middle">{marker.rail}</text>
      </g>
    );
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Circuit Diagram Studio home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>Circuit<span className="brand-light">Studio</span></span>
        </a>
        <div className="document-title">
          <span className="document-dot" />
          <span>Untitled circuit</span>
          <span className="saved-label">Current session</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} disabled={!past.length}><Icon name="undo" /></button>
          <button className="icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={redo} disabled={!future.length}><Icon name="redo" /></button>
          <span className="action-divider" />
          <button className="button button-muted" onClick={() => fileInputRef.current?.click()}><Icon name="open" /> <span>Open</span></button>
          <button className="button button-primary" onClick={saveJson}><Icon name="download" /> <span>Save JSON</span></button>
          <input ref={fileInputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => {
            void openFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }} />
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">WORKSPACE</p>
              <h1>Components</h1>
            </div>
            <span className="count-badge">{Object.keys(COMPONENT_REGISTRY).length}</span>
          </div>
          <label className="search-field">
            <Icon name="search" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a component..." aria-label="Search components" />
            {query && <button aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
          </label>
          <p className="section-label">COMPONENTS</p>
          <div className="component-library">
            {filteredComponents.map((type) => (
              <button
                key={type}
                className={`library-item ${tool === type ? "library-item-active" : ""}`}
                onClick={() => { setTool(type); setMessage(`Click the canvas to place a ${COMPONENT_REGISTRY[type].title.toLowerCase()}.`); }}
                draggable
                onDragStart={(event) => handleComponentDragStart(event, type)}
                title="Click to select for placement, or drag onto the canvas"
                aria-pressed={tool === type}
              >
                <span className={`library-icon ${type}`}>
                  {type === "esp32-c3-zero" ? <svg viewBox="0 0 48 32"><rect x="10" y="3" width="28" height="26" rx="3" /><path d="M4 7h6m-6 6h6m-6 6h6m-6 6h6m28-18h6m-6 6h6m-6 6h6m-6 6h6M19 11h10v10H19z" /></svg> :
                    type === "timer-555" ? <svg viewBox="0 0 48 32"><rect x="13" y="2" width="22" height="28" rx="3" /><path d="M6 6h7m-7 7h7m-7 6h7m-7 7h7M35 6h7m-7 7h7m-7 6h7m-7 7h7" /><text x="24" y="19" textAnchor="middle">555</text></svg> :
                    type === "qx5252f-to94" ? <svg viewBox="0 0 48 32"><rect x="7" y="3" width="34" height="24" rx="3" /><path d="M12 27v3m8-3v3m8-3v3m8-3v3" /><text x="24" y="17" textAnchor="middle">QX</text></svg> :
                    type === "power-supply" ? <svg viewBox="0 0 48 32"><path d="M2 16h10m24 0h10" /><circle cx="24" cy="16" r="12" /><path d="M21 16h6m-3-3v6m4-3h4" /></svg> :
                    type === "inductor" ? <svg viewBox="0 0 48 32"><path d="M2 16h8c0-14 10-14 10 0 0-14 10-14 10 0 0-14 10-14 10 0h6" /></svg> :
                    type === "rechargeable-battery" ? <svg viewBox="0 0 48 32"><path d="M4 16h14m12 0h14M18 7v18m12-13v8M6 4a8 8 0 0 1 12 5m0-5v5h-5" /></svg> :
                    type === "solar-panel" ? <svg viewBox="0 0 48 32"><path d="M2 16h7m31 0h6M9 6h30v20H9zM19 6v20m10-20v20M9 16h30M16 3V1m-6 4-2-2m20 0 2-2" /></svg> :
                    type === "push-button" ? <svg viewBox="0 0 48 32"><path d="M2 22h12m20 0h12M14 22l13-9V6m-7 0h14" /><circle cx="14" cy="22" r="2" /><circle cx="34" cy="22" r="2" /></svg> :
                    type === "resistor" ? <svg viewBox="0 0 48 32"><path d="M2 16h8l5-9 7 18 7-18 7 18 5-9h5" /></svg> :
                    type === "potentiometer" ? <svg viewBox="0 0 48 32"><path d="M2 16h8l5-9 7 18 7-18 7 18 5-9h5M24 30V17m-5-7 5 7 5-7" /></svg> :
                    type === "led" ? <svg viewBox="0 0 48 32"><path d="M2 20h14m0-9v18l14-9zm14-9v18m0-9h14M24 9l5-6m4 6 5-6" /></svg> :
                    <svg viewBox="0 0 48 32"><path d="M2 16h15m0-10v20m14-20v20m0-10h15" /></svg>}
                </span>
                <span className="library-copy">
                  <strong>{COMPONENT_REGISTRY[type].title}</strong>
                  <small>{COMPONENT_REGISTRY[type].description}</small>
                </span>
                <span className="drag-hint">+</span>
              </button>
            ))}
            {!filteredComponents.length && <p className="empty-search">No components match “{query}”.</p>}
          </div>

          <p className="section-label tools-label">TOOLS</p>
          <button className={`tool-row ${tool === "select" ? "tool-row-active" : ""}`} onClick={() => { setTool("select"); setSelectedPowerMarkerId(null); }} aria-pressed={tool === "select"}>
            <Icon name="cursor" size={18} /><span>Select &amp; move</span><kbd>V</kbd>
          </button>
          <button className={`tool-row ${tool === "wire" ? "tool-row-active" : ""}`} onClick={() => { setTool("wire"); setWireStart(null); setSelectedPowerMarkerId(null); setMessage("Click a component terminal or wire bend node to start a wire."); }} aria-pressed={tool === "wire"}>
            <Icon name="wire" size={18} /><span>Wire</span><kbd>W</kbd>
          </button>
          <button
            className={`tool-row ${tool === "power" ? "tool-row-active" : ""}`}
            onClick={() => {
              setTool("power");
              setWireStart(null);
              setSelectedPowerMarkerId(null);
              setMessage(`Choose a rail, then click a component pin, wire node, or wire.`);
            }}
            aria-pressed={tool === "power"}
          >
            <Icon name="power" size={18} /><span>Power</span><kbd>P</kbd>
          </button>
          {tool === "power" && (
            <label className="power-rail-picker">
              <span>Rail</span>
              <select
                aria-label="Power rail"
                value={powerRail}
                onChange={(event) => {
                  const rail = POWER_RAILS.find((item) => item === event.target.value);
                  if (rail) setPowerRail(rail);
                }}
              >
                {POWER_RAILS.map((rail) => <option key={rail} value={rail}>{rail}</option>)}
              </select>
            </label>
          )}

          <div className="sidebar-spacer" />
          <div className="help-card">
            <span className="help-icon">?</span>
            <div><strong>Quick tip</strong><p>Click or drag a component onto the canvas. Double-click a label to rename it or a wire to add a node.</p></div>
          </div>
          <div className="sidebar-footer"><span className="online-dot" /> Your diagram stays in this session</div>
        </aside>

        <section className="editor">
          <div className="editor-toolbar">
            <div className="toolbar-left">
              <span className="canvas-title">Canvas</span>
              <span className="toolbar-divider" />
              <label className="grid-control">
                <span>Grid</span>
                <button className="stepper-button" aria-label="Decrease grid size" onClick={() => changeGridSize(-5)}><Icon name="minus" size={13} /></button>
                <span className="grid-size">{diagram.settings.gridSize}px</span>
                <button className="stepper-button" aria-label="Increase grid size" onClick={() => changeGridSize(5)}><Icon name="plus" size={13} /></button>
              </label>
              <label className="snap-toggle"><input type="checkbox" checked={diagram.settings.snapToGrid} onChange={(event) =>
                updateDiagram((current) => ({ ...current, settings: { ...current.settings, snapToGrid: event.target.checked } }))} /><span>Snap</span></label>
              {selectedComponent && (
                <label className="label-control">
                  <span>Label</span>
                  <input
                    aria-label="Component label"
                    value={labelDraft}
                    maxLength={32}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onBlur={(event) => commitLabel(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        setLabelDraft(selectedComponent.label);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
              )}
            </div>
            <div className="toolbar-right">
              <button
                className="icon-button toolbar-icon"
                title={selectedComponent ? `Rotate component from ${selectedComponent.rotation}° (R)` : "Select a component to rotate"}
                aria-label="Rotate selected component"
                onClick={rotateSelected}
                disabled={!selectedComponent}
              >
                <Icon name="rotate" />
              </button>
              <button className="icon-button toolbar-icon" title="Export diagram as PNG" aria-label="Export diagram as PNG" onClick={() => void exportImage()}><Icon name="image" /></button>
              <span className="toolbar-divider" />
              <button className="icon-button toolbar-icon" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(viewport.zoom / 1.15)}><Icon name="zoomOut" /></button>
              <span className="zoom-value">{Math.round(viewport.zoom * 100)}%</span>
              <button className="icon-button toolbar-icon" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(viewport.zoom * 1.15)}><Icon name="zoomIn" /></button>
              <button className="icon-button toolbar-icon fit-button" title="Fit diagram" aria-label="Fit diagram" onClick={fitView}><Icon name="fit" /></button>
            </div>
          </div>

          <div className={`canvas-wrap ${tool === "wire" ? "wire-mode" : ""} ${tool === "power" ? "power-mode" : ""} ${dragging ? "is-dragging" : ""}`}>
            <svg
              ref={svgRef}
              className="diagram-canvas"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
              role="img"
              aria-label="Circuit diagram canvas. Click to place components, drag to move or pan, connect component terminals or wire nodes, and use the mouse wheel to zoom."
            >
              <defs>
                <pattern
                  id="grid"
                  width={diagram.settings.gridSize}
                  height={diagram.settings.gridSize}
                  patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
                >
                  <circle cx="1" cy="1" r="1" className="grid-dot" />
                </pattern>
              </defs>
              <rect className="canvas-background" width="100%" height="100%" />
              <rect className="canvas-grid" width="100%" height="100%" fill="url(#grid)" />
              <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
                {wireLines}
                {wireNodeHandles}
                {wireStart && (() => {
                  const start = wireEndpointPosition(diagram, wireStart);
                  if (!start) return null;
                  return <circle className="wire-start-ring" cx={start.x} cy={start.y} r="9" />;
                })()}
                {diagram.components.map((component) => (
                  <ComponentShape
                    key={component.id}
                    component={component}
                    selected={component.id === selectedId}
                    onPointerDown={handleComponentPointerDown}
                    onTerminalClick={handleTerminalClick}
                    powerMode={tool === "power"}
                    onPowerTerminalClick={handlePowerTerminalClick}
                    wireMode={tool === "wire"}
                    editingLabel={editingLabelId === component.id}
                    labelDraft={labelDraft}
                    onLabelChange={setLabelDraft}
                    onLabelCommit={(value) => {
                      commitLabel(value);
                      setEditingLabelId(null);
                    }}
                    onLabelCancel={() => {
                      setLabelDraft(component.label);
                      setEditingLabelId(null);
                    }}
                    onBeginLabelEdit={beginLabelEdit}
                  />
                ))}
                {powerMarkerElements}
              </g>
            </svg>

            {!diagram.components.length && (
              <div className="canvas-empty-state">
                <div className="empty-illustration">
                  <svg viewBox="0 0 200 112" aria-hidden="true">
                    <path d="M18 56h35m94 0h35" />
                    <path d="m53 56 10-17 15 34 15-34 15 34 15-17 9 0" />
                    <circle cx="18" cy="56" r="4" /><circle cx="182" cy="56" r="4" />
                    <path className="empty-cap" d="M91 96h18m-9-10v20m11-20v20" />
                  </svg>
                </div>
                <h2>Your canvas is ready</h2>
                <p>Pick a component from the library to start building your circuit.</p>
                <button className="button button-primary empty-cta" onClick={() => setTool("resistor")}>Add your first resistor <span>→</span></button>
                <span className="empty-shortcut">or press <kbd>V</kbd> to select and <kbd>W</kbd> to wire</span>
              </div>
            )}

            {tool === "wire" && <div className="canvas-hint"><Icon name="wire" size={15} /> {wireStart ? "Choose a terminal or wire node to connect to" : "Select a terminal or wire node to begin"} <kbd>Esc</kbd></div>}
            {tool === "power" && <div className="canvas-hint"><Icon name="power" size={15} /> Click a pin, wire node, or wire to place {powerRail} <kbd>Esc</kbd></div>}
            <div className="canvas-coordinate">{diagram.components.length} component{diagram.components.length === 1 ? "" : "s"} <span>·</span> {diagram.wires.length} wire{diagram.wires.length === 1 ? "" : "s"}</div>
          </div>

          <div className="statusbar">
            <div className="status-message" role="status">{message || (selectedId ? "Component selected · drag to reposition" : "Ready · Select a tool or place a component")}</div>
            <div className="status-shortcuts"><span><kbd>Ctrl</kbd> <kbd>Z</kbd> Undo</span><span><kbd>Del</kbd> Remove</span><span>Scroll to zoom</span></div>
          </div>
        </section>
      </div>
    </main>
  );
}
