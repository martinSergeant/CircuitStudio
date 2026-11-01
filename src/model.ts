export type ComponentKind = "resistor" | "capacitor" | "led" | "potentiometer" | "esp32-c3-zero" | "timer-555" | "push-button" | "power-supply" | "qx5252f-to94" | "inductor" | "rechargeable-battery" | "solar-panel";
export type Tool = "select" | "wire" | "power" | ComponentKind;
export type TerminalId = number;

export interface TerminalDefinition {
  id: TerminalId;
  label?: string;
  x: number;
  y: number;
}

export interface CircuitComponent {
  id: string;
  type: ComponentKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  label: string;
}

export interface WireNode {
  id: string;
  x: number;
  y: number;
}

export type WireEndpoint =
  | { componentId: string; terminal: TerminalId }
  | { wireId: string; nodeId: string };

export const POWER_RAILS = ["+5V", "+3V3", "GND", "-5V"] as const;
export type PowerRail = (typeof POWER_RAILS)[number];

function isPowerRail(value: unknown): value is PowerRail {
  return POWER_RAILS.some((rail) => rail === value);
}

export interface PowerMarker {
  id: string;
  rail: PowerRail;
  endpoint: WireEndpoint;
}

export interface Wire {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
  nodes?: WireNode[];
}

export interface Diagram {
  schemaVersion: 1;
  components: CircuitComponent[];
  wires: Wire[];
  powerMarkers: PowerMarker[];
  settings: {
    gridSize: number;
    snapToGrid: boolean;
  };
}

export const TERMINAL_OFFSET = 60;

export const COMPONENT_REGISTRY: Record<
  ComponentKind,
  { title: string; description: string; color: string; labelPrefix: string }
> = {
  resistor: {
    title: "Resistor",
    description: "Limits current flow",
    color: "#e3932d",
    labelPrefix: "R",
  },
  capacitor: {
    title: "Capacitor",
    description: "Stores electrical energy",
    color: "#5584d9",
    labelPrefix: "C",
  },
  inductor: {
    title: "Inductor",
    description: "Stores energy in a magnetic field",
    color: "#a667b8",
    labelPrefix: "L",
  },
  "rechargeable-battery": {
    title: "Rechargeable Battery",
    description: "Two-terminal rechargeable cell",
    color: "#3d927b",
    labelPrefix: "BT",
  },
  "solar-panel": {
    title: "Solar Panel",
    description: "Photovoltaic panel with positive and negative terminals",
    color: "#d89433",
    labelPrefix: "PV",
  },
  led: {
    title: "LED",
    description: "Emits light (anode left)",
    color: "#d9534f",
    labelPrefix: "D",
  },
  "push-button": {
    title: "Push Button",
    description: "Momentary normally-open switch",
    color: "#4b9b86",
    labelPrefix: "SW",
  },
  "power-supply": {
    title: "Power Supply",
    description: "Generic two-terminal DC supply (+ / −)",
    color: "#3d927b",
    labelPrefix: "PS",
  },
  "qx5252f-to94": {
    title: "QX5252F TO-94",
    description: "Four-pin solar LED driver · SBAT, BAT, VSS, LX",
    color: "#536c8a",
    labelPrefix: "U",
  },
  potentiometer: {
    title: "Potentiometer",
    description: "Adjustable three-terminal resistor",
    color: "#b779c7",
    labelPrefix: "RV",
  },
  "timer-555": {
    title: "555 Timer",
    description: "8-pin timer IC · GND, TRIG, OUT, RESET, CTRL, THRESH, DISCH, VCC",
    color: "#536c8a",
    labelPrefix: "U",
  },
  "esp32-c3-zero": {
    title: "ESP32-C3-Zero",
    description: "15 GPIO + power · 18 exposed pins",
    color: "#3478c8",
    labelPrefix: "U",
  },
};

export function isComponentKind(value: unknown): value is ComponentKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMPONENT_REGISTRY, value);
}

const ESP32_C3_ZERO_PINS = [
  { id: 1, label: "5V", x: -80, y: -80 },
  { id: 2, label: "GND", x: -80, y: -60 },
  { id: 3, label: "3V3", x: -80, y: -40 },
  { id: 4, label: "GPIO0", x: -80, y: -20 },
  { id: 5, label: "GPIO1", x: -80, y: 0 },
  { id: 6, label: "GPIO2", x: -80, y: 20 },
  { id: 7, label: "GPIO3", x: -80, y: 40 },
  { id: 8, label: "GPIO4", x: -80, y: 60 },
  { id: 9, label: "GPIO5", x: -80, y: 80 },
  { id: 18, label: "GPIO21 · TX", x: 80, y: -80 },
  { id: 17, label: "GPIO20 · RX", x: 80, y: -60 },
  { id: 16, label: "GPIO19 D+", x: 80, y: -40 },
  { id: 15, label: "GPIO18 D−", x: 80, y: -20 },
  { id: 14, label: "GPIO10 RGB", x: 80, y: 0 },
  { id: 13, label: "GPIO9 BOOT", x: 80, y: 20 },
  { id: 12, label: "GPIO8", x: 80, y: 40 },
  { id: 11, label: "GPIO7", x: 80, y: 60 },
  { id: 10, label: "GPIO6", x: 80, y: 80 },
] satisfies TerminalDefinition[];

const TIMER_555_PINS = [
  { id: 1, label: "GND", x: -40, y: 20 },
  { id: 2, label: "TRIG", x: -40, y: 0 },
  { id: 3, label: "OUT", x: -40, y: -20 },
  { id: 4, label: "RESET", x: -40, y: -40 },
  { id: 5, label: "CTRL", x: 40, y: 20 },
  { id: 6, label: "THRESH", x: 40, y: 0 },
  { id: 7, label: "DISCH", x: 40, y: -20 },
  { id: 8, label: "VCC", x: 40, y: -40 },
] satisfies TerminalDefinition[];

const QX5252F_TO94_PINS = [
  { id: 1, label: "SBAT", x: -30, y: 20 },
  { id: 2, label: "BAT", x: -10, y: 20 },
  { id: 3, label: "VSS", x: 10, y: 20 },
  { id: 4, label: "LX", x: 30, y: 20 },
] satisfies TerminalDefinition[];

export function getTerminals(type: ComponentKind): TerminalDefinition[] {
  if (type === "esp32-c3-zero") return ESP32_C3_ZERO_PINS;
  if (type === "timer-555") return TIMER_555_PINS;
  if (type === "qx5252f-to94") return QX5252F_TO94_PINS;
  if (type === "push-button") {
    return [
      { id: 0, x: -TERMINAL_OFFSET, y: 0 },
      { id: 1, x: TERMINAL_OFFSET, y: 0 },
    ];
  }
  if (type === "potentiometer") {
    return [
      { id: 0, x: -TERMINAL_OFFSET, y: 0 },
      { id: 1, x: TERMINAL_OFFSET, y: 0 },
      { id: 2, x: 0, y: TERMINAL_OFFSET },
    ];
  }
  return [
    { id: 0, x: -TERMINAL_OFFSET, y: 0 },
    { id: 1, x: TERMINAL_OFFSET, y: 0 },
  ];
}

export function createEmptyDiagram(): Diagram {
  return {
    schemaVersion: 1,
    components: [],
    wires: [],
    powerMarkers: [],
    settings: { gridSize: 20, snapToGrid: true },
  };
}

export function terminalPosition(
  component: CircuitComponent,
  terminal: TerminalId,
): { x: number; y: number } {
  const definition = getTerminals(component.type).find((item) => item.id === terminal);
  if (!definition) {
    throw new Error(`Unknown terminal ${terminal} on ${component.type}.`);
  }
  const { x, y } = definition;
  switch (component.rotation) {
    case 90:
      return { x: component.x - y, y: component.y + x };
    case 180:
      return { x: component.x - x, y: component.y - y };
    case 270:
      return { x: component.x + y, y: component.y - x };
    default:
      return { x: component.x + x, y: component.y + y };
  }
}

export function wireEndpointPosition(
  diagram: Pick<Diagram, "components" | "wires">,
  endpoint: WireEndpoint,
): { x: number; y: number } | undefined {
  if ("wireId" in endpoint) {
    return diagram.wires
      .find((wire) => wire.id === endpoint.wireId)
      ?.nodes?.find((node) => node.id === endpoint.nodeId);
  }
  const component = diagram.components.find((item) => item.id === endpoint.componentId);
  return component ? terminalPosition(component, endpoint.terminal) : undefined;
}

function makeNodeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validateDiagram(value: unknown): Diagram {
  if (!value || typeof value !== "object") {
    throw new Error("The selected file does not contain a diagram.");
  }
  const candidate = value as Partial<Diagram>;
  if (
    candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.components) ||
    !Array.isArray(candidate.wires) ||
    !candidate.settings ||
    typeof candidate.settings.gridSize !== "number" ||
    typeof candidate.settings.snapToGrid !== "boolean"
  ) {
    throw new Error("This file is not a supported circuit diagram (schema version 1).");
  }

  const componentIds = new Set<string>();
  const components = candidate.components.map((component) => {
    if (
      !component ||
      typeof component.id !== "string" ||
      componentIds.has(component.id) ||
      !isComponentKind(component.type) ||
      !Number.isFinite(component.x) ||
      !Number.isFinite(component.y) ||
      (component.rotation !== undefined &&
        component.rotation !== 0 &&
        component.rotation !== 90 &&
        component.rotation !== 180 &&
        component.rotation !== 270) ||
      typeof component.label !== "string"
    ) {
      throw new Error("The diagram contains an invalid or duplicate component.");
    }
    componentIds.add(component.id);
    return {
      id: component.id,
      type: component.type,
      x: component.x,
      y: component.y,
      rotation: component.rotation ?? 0,
      label: component.label,
    };
  });
  const componentById = new Map(components.map((component) => [component.id, component]));
  const wireIds = new Set<string>();
  const nodeIds = new Set<string>();
  const wireCandidates = candidate.wires.map((value) => {
    const wire = value as { id?: unknown; from?: unknown; to?: unknown; nodes?: unknown };
    const id = wire?.id;
    const rawNodes = wire?.nodes;
    if (
      !wire ||
      typeof id !== "string" ||
      !id ||
      wireIds.has(id) ||
      (rawNodes !== undefined && (!Array.isArray(rawNodes) || rawNodes.length > 128))
    ) {
      throw new Error("The diagram contains an invalid wire.");
    }
    wireIds.add(id);
    const nodes = Array.isArray(rawNodes) ? rawNodes.map((value) => {
      const node = value as Partial<WireNode>;
      if (
        !node ||
        typeof node.x !== "number" ||
        !Number.isFinite(node.x) ||
        typeof node.y !== "number" ||
        !Number.isFinite(node.y)
      ) {
        throw new Error("The diagram contains an invalid wire node.");
      }
      const id = node.id === undefined ? makeNodeId() : node.id;
      if (typeof id !== "string" || !id || nodeIds.has(id)) {
        throw new Error("The diagram contains an invalid or duplicate wire node.");
      }
      nodeIds.add(id);
      return { id, x: node.x, y: node.y };
    }) : undefined;
    return { id, from: wire.from, to: wire.to, nodes };
  });
  const nodeReferences = new Set(
    wireCandidates.flatMap(({ id, nodes }) =>
      (nodes ?? []).map((node) => JSON.stringify([id, node.id]))),
  );
  const normalizeEndpoint = (value: unknown, ownerWireId?: string): WireEndpoint | null => {
    if (!value || typeof value !== "object") return null;
    const endpoint = value as Record<string, unknown>;
    if ("wireId" in endpoint) {
      if (
        "componentId" in endpoint ||
        typeof endpoint.wireId !== "string" ||
        typeof endpoint.nodeId !== "string" ||
        (ownerWireId !== undefined && endpoint.wireId === ownerWireId) ||
        !nodeReferences.has(JSON.stringify([endpoint.wireId, endpoint.nodeId]))
      ) return null;
      return { wireId: endpoint.wireId, nodeId: endpoint.nodeId };
    }
    if (
      typeof endpoint.componentId !== "string" ||
      typeof endpoint.terminal !== "number" ||
      !Number.isInteger(endpoint.terminal)
    ) return null;
    const component = componentById.get(endpoint.componentId);
    if (!component || !getTerminals(component.type).some((terminal) => terminal.id === endpoint.terminal)) {
      return null;
    }
    return { componentId: endpoint.componentId, terminal: endpoint.terminal };
  };
  const endpointKey = (endpoint: WireEndpoint) => "wireId" in endpoint
    ? JSON.stringify(["node", endpoint.wireId, endpoint.nodeId])
    : JSON.stringify(["terminal", endpoint.componentId, endpoint.terminal]);
  const wires = wireCandidates.map(({ id, from: rawFrom, to: rawTo, nodes }) => {
    const from = normalizeEndpoint(rawFrom, id);
    const to = normalizeEndpoint(rawTo, id);
    if (!from || !to || endpointKey(from) === endpointKey(to)) {
      throw new Error("The diagram contains an invalid wire connection.");
    }
    return {
      id,
      from,
      to,
      ...(nodes ? { nodes } : {}),
    };
  });

  if (candidate.powerMarkers !== undefined && !Array.isArray(candidate.powerMarkers)) {
    throw new Error("The diagram contains invalid power markers.");
  }
  const powerMarkerIds = new Set<string>();
  const powerMarkerEndpoints = new Set<string>();
  const powerMarkers = (candidate.powerMarkers ?? []).map((value) => {
    const marker = value as { id?: unknown; rail?: unknown; endpoint?: unknown };
    const endpoint = normalizeEndpoint(marker?.endpoint);
    if (
      !marker ||
      typeof marker.id !== "string" ||
      !marker.id ||
      powerMarkerIds.has(marker.id) ||
      !isPowerRail(marker.rail) ||
      !endpoint ||
      powerMarkerEndpoints.has(endpointKey(endpoint))
    ) {
      throw new Error("The diagram contains an invalid or duplicate power marker.");
    }
    powerMarkerIds.add(marker.id);
    powerMarkerEndpoints.add(endpointKey(endpoint));
    return { id: marker.id, rail: marker.rail, endpoint };
  });

  const { gridSize, snapToGrid } = candidate.settings;
  if (!Number.isFinite(gridSize) || gridSize < 5 || gridSize > 100) {
    throw new Error("The diagram's grid size must be between 5 and 100.");
  }

  return {
    schemaVersion: 1,
    components,
    wires,
    powerMarkers,
    settings: { gridSize, snapToGrid },
  };
}
