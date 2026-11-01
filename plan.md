# Circuit Diagram Editor Plan

## Goal

Build a responsive React and Vite web app for creating, editing, saving, and
sharing circuit diagrams. Start with a dependable editor for resistors,
capacitors, and wires; keep the component model extensible so more components
can be added later.

## Phases

### 1. Establish the app foundation

- Set up the React/Vite app structure and a responsive application layout.
- Define a versioned diagram data model for components, connections, and
  document settings.
- Create a component registry so each component's metadata, rendering, and
  default properties can be extended independently.

**Done when:** the app starts successfully, the main editor layout works on
desktop and mobile widths, and an empty diagram can be represented by the data
model.

### 2. Build the diagram canvas

- Render a pannable, zoomable canvas with a configurable grid.
- Implement grid snapping and make snapping behavior configurable.
- Add basic component shapes for resistors, capacitors, LEDs, push buttons,
  potentiometers, an inductor, a rechargeable battery, a solar panel, a generic
  two-terminal power supply, the 555 timer IC, and the ESP32-C3-Zero
  development board and QX5252F TO-94 driver with individually connectable pins.
- Lay out 555 timer pins one grid unit apart, directly on the chip body, with
  short internal pin strokes and nearby labels.
- Support selecting, placing, moving, rotating in four quarter-turn
  orientations, and deleting components.
- Align component terminal positions with the default 20px grid while preserving
  consistent pin spacing.

**Done when:** users can place and reposition the initial components precisely,
rotate components, and canvas navigation does not accidentally modify the
diagram.

### 3. Add connections and editing controls

- Implement wire creation between component connection points.
- Allow users to add bend nodes to wires and move or remove nodes independently;
  wire endpoints remain attached to their component terminals.
- Allow wires to connect to existing wire bend nodes, creating visible junctions
  that move with their shared connection point.
- Add named power markers (+5V, +3V3, GND, and −5V) to component terminals,
  wire nodes, or wire segments so matching rail names identify a shared net.
- Add a searchable component library with the initial components and wire tool.
- Allow components to be added by clicking the library or dragging them onto
  the canvas.
- Add undo and redo for diagram edits, including component and wire changes.
- Keep keyboard and pointer interactions consistent and usable.

**Done when:** users can find components, connect them with wires, annotate
power nets, and reliably undo or redo supported editing actions.

### 4. Save, load, and export diagrams

- Save and reopen diagrams using the versioned JSON format.
- Provide image export for sharing and JSON export for portability.
- Validate imported JSON and provide a clear error for unsupported or invalid
  files rather than silently loading a partial diagram.

**Done when:** a saved diagram can be reopened without losing its contents, and
both export formats produce usable files.

### 5. Polish and verify

- Refine responsive behavior and provide clear controls for common editor
  actions.
- Keep the component library proportional to the available sidebar height, with
  its items scrolling independently from tools and help.
- Test core workflows: placement, snapping, wiring, search, undo/redo, save/load,
  and exports.
- Check empty, invalid-file, and small-screen states.

**Done when:** the main workflows pass their tests and the editor remains usable
on supported desktop and mobile screen sizes.

## Initial scope

- **Include:** resistors, capacitors, LEDs, momentary normally-open push
  buttons, potentiometers, inductors, rechargeable batteries, solar panels, a
  generic +/− power supply with an editable voltage label, the 555 timer with
  all eight pins, the ESP32-C3-Zero with all exposed pins, and the QX5252F TO-94
  with SBAT, BAT, VSS, and LX pins; wires, four-way component rotation, grid
  snapping, pan and zoom, named power markers (+5V, +3V3, GND, and −5V),
  component search, undo/redo, JSON save/load, and image/JSON export.
- **Defer:** circuit simulation, electrical rule checking, collaboration, and
  advanced component types until the initial editor workflows are reliable.

## Guiding decisions

- Keep diagram data separate from canvas rendering and interaction state.
- Make component types additive through the component registry, without
  requiring changes to core canvas behavior for each new type.
- Treat the JSON schema as a versioned format so future changes can be migrated.
