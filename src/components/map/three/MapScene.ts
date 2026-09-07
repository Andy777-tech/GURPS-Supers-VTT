import { isTacticalScale } from '../../../utils/mapScale';
import type { MeasureBox } from '../../../utils/stamps';
import { edgeKey, splitEdgeKey } from '../../../utils/mapEdges';
import type { EdgeState } from '../../../utils/mapEdges';
import type { EdgeKey } from '../../../types/map';
import { indexFootprints, layerAnchor } from '../../../utils/footprints';
import { normalizeRotation } from '../../../utils/imageLayerTransform';
import { getAssetStore } from '../../../assets/assetStore';
import * as THREE from 'three';
import type { ImageLayerId, MapImageLayer, MapModel, TerrainId, TileId } from '../../../types/map';
import { getEffectiveElevation } from '../../../utils/lineOfSight';
import {
  cameraPosition,
  dragPan,
  frameTiles,
  clampCamera,
  orbit,
  tokenOffsets,
  zoom,
  type CameraState,
} from '../../../utils/mapSceneMath';
import { findTileGridPos } from '../../../utils/mapUtils';
import { ALIGN_BOX_CELLS, type AlignBox } from '../../../utils/imageAlign';

export interface EdgePick {
  a: TileId;
  b: TileId;
  key: EdgeKey;
}

export interface TilePointerEvent {
  shiftKey?: boolean;
  clientX: number;
  clientY: number;
  button: number;
  preventDefault(): void;
}

export interface MapSceneCallbacks {
  /** Deferred single click; true consumes the click, false falls through to the tile. */
  onEdgeClick?(edge: EdgePick, ev: TilePointerEvent): boolean;
  onEdgeDoubleClick?(edge: EdgePick): void;
  onTileClick(tileId: TileId, row: number, col: number, ev: TilePointerEvent): void;
  onTileContextMenu(tileId: TileId, row: number, col: number, ev: TilePointerEvent): void;
  onTilePaintStart(tileId: TileId, row: number, col: number, ev: TilePointerEvent): void;
  onTilePaintEnter(tileId: TileId, row: number, col: number, ev: TilePointerEvent): void;
  onHoverTile(info: { tileId: TileId; row: number; col: number; clientX: number; clientY: number } | null): void;
  /**
   * Return true to begin dragging the token on this tile (left-drag).
   * When false/absent, a left-drag on the tile orbits the camera as usual.
   */
  onTokenDragStart?(tileId: TileId, row: number, col: number): boolean;
  /** A token drag ended over a different tile. */
  onTokenDrop?(from: TokenDragTile, to: TokenDragTile): void;
  /**
   * Wheel with Ctrl/Cmd ('brush') or Shift ('elevation') held.
   * direction is +1 scrolling up, -1 scrolling down. Return true when
   * handled; false falls through to camera zoom.
   */
  onModifierWheel?(kind: 'brush' | 'elevation', direction: 1 | -1): boolean;
  /**
   * An image-align drag finished: the box is in fractional world tile units
   * (x = column, y = row, min corner). Fired only while alignMode is active.
   */
  onAlignBoxComplete?(box: AlignBox): void;
  onContextLost?(): void;
  onContextRestored?(): void;
}

export interface TokenDragTile {
  tileId: TileId;
  row: number;
  col: number;
}

export type FogMode = 'gm' | 'player-los' | 'player-open';

/** A group, vehicle, or combat actor token rendered on a tile. */
export interface MapToken {
  id: string;
  tileId: TileId;
  /** CSS color for the token body (e.g. category color). */
  color: string;
  kind?: 'group' | 'vehicle';
  image?: string;
  label?: string;
  dimmed?: boolean;
  /** Current actor: rendered larger with a white base ring. */
  isCurrent?: boolean;
  /** Selected token: yellow base ring. */
  isSelected?: boolean;
}

export interface MapSceneFrameData {
  map: MapModel;
  gridLines: boolean;
  fog: FogMode;
  visibleTileIds: Set<TileId> | null;
  selectedTileIds: Set<TileId> | null;
  routeTileIds: TileId[] | null;
  reachableTileIds: Set<TileId> | null;
  tokens: MapToken[] | null;
  paintModeActive: boolean;
  placingToken: boolean;
  /**
   * Roll20-style image alignment mode: left-drag draws a 3×3 preview box on
   * the plane at this elevation instead of painting/clicking/orbiting.
   * When planeFromPointerTile is true, lock the drag plane at pointer-down to
   * the pointer tile's effective elevation, falling back to elevation off-map.
   * Otherwise the plane is always at elevation.
   */
  alignMode: { elevation: number; planeFromPointerTile?: boolean } | null;
  measureBox: MeasureBox | null;
  edges: Map<EdgeKey, EdgeState> | null;
  footprints: { editingLayerId: ImageLayerId | null; showTints: boolean } | null;
}

interface EdgePlacement {
  x: number;
  z: number;
  vertical: boolean;
  y: number;
}

interface PickEntry {
  tileId: TileId;
  row: number;
  col: number;
}

interface PointerDrag {
  button: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
  lastPaintedTileId: TileId | null;
  /** Set when the drag started on a draggable token — moves the token, not the camera. */
  tokenFrom: PickEntry | null;
  /** Set when the drag is drawing an image-align box (world x/z of the anchor corner). */
  alignStart: { x: number; z: number } | null;
  alignPlaneY: number | null;
}

const FOOTPRINT_PALETTE = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#f87171'];
/**
 * Footprint tints and the overlap checker are transparent, and three.js sorts transparent
 * objects by object position (an InstancedMesh sits at the origin), so without an explicit
 * order the underlay image planes (renderOrder 0) can paint over them. Draw them after
 * underlays but before overlay images (1000+) and the editing outline (1500).
 */
const FOOTPRINT_TINT_RENDER_ORDER = 900;
const FOOTPRINT_CHECKER_RENDER_ORDER = 901;
// Above underlay 0 / tints 900–901; below overlays 1000+.
const GRID_LINE_RENDER_ORDER = 950;
const TILE_LIFT = 0.35;
const BASE_PLATE = 0.06;
const CAMERA_FOV = 45;
const DRAG_THRESHOLD = 5;
const EDGE_PICK_BAND = 0.28;
const WALL_HEIGHT = 0.32;

export class MapScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: MapSceneCallbacks;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 500);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private cameraState: CameraState = frameTiles(0, 0, 1, 1);
  private data: MapSceneFrameData | null = null;
  private tileMesh: THREE.InstancedMesh | null = null;
  private overlayMesh: THREE.InstancedMesh | null = null;
  private structureMesh: THREE.InstancedMesh | null = null;
  private edgeGroup: THREE.Group | null = null;
  private edgeHover: THREE.Group | null = null;
  private edgeHoverKey: EdgeKey | null = null;
  private pendingEdgeClick: ReturnType<typeof setTimeout> | null = null;
  private measureGroup: THREE.Group | null = null;
  private gridGroup: THREE.Group | null = null;
  private footprintGroup: THREE.Group | null = null;
  private footprintCheckerTexture: THREE.CanvasTexture | null = null;
  private imageGroup: THREE.Group | null = null;
  /** Textures cached per layer and content key so paint rebuilds do not re-decode. */
  private readonly imageTextures = new Map<string, { key: string; texture: THREE.Texture | null; assetId?: string }>();
  private readonly missingImageAssets = new Set<string>();
  private readonly assetStore = getAssetStore();
  /** Round-cropped portrait textures cached by stable token id and source reference. */
  private readonly tokenImageTextures = new Map<string, { src: string; texture: THREE.CanvasTexture }>();
  /** Live 3×3 preview rectangle while an image-align drag is in progress. */
  private alignRectGroup: THREE.Group | null = null;
  private markerGroup: THREE.Group | null = null;
  private linkGroup: THREE.Group | null = null;
  private tokenGroup: THREE.Group | null = null;
  private markerTexture: THREE.CanvasTexture | null = null;
  private pickEntries: PickEntry[] = [];
  private renderedTileIds = new Set<TileId>();
  private hoveredTileId: TileId | null = null;
  private pointerDrag: PointerDrag | null = null;
  private needsRender = false;
  private contextLost = false;
  private disposed = false;
  private animationFrame = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: MapSceneCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      this.renderer = null;
      return;
    }

    this.renderer.setClearColor('#0a0a0f');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.bindEvents();
    this.resize();
    this.animationFrame = requestAnimationFrame(this.renderLoop);
  }

  get ok(): boolean {
    return this.renderer !== null && !this.contextLost;
  }

  update(data: MapSceneFrameData): void {
    if (!this.renderer) return;
    const oldData = this.data;
    const switchedMap = oldData?.map.id !== data.map.id;
    if (switchedMap) {
      this.clearPendingEdgeClick();
      if (oldData) this.saveCamera(oldData.map.id);
      this.data = data;
      this.restoreOrFrameCamera();
    } else {
      this.data = data;
    }

    const rebuildTiles = !oldData
      || oldData.map !== data.map
      || oldData.map.rows !== data.map.rows
      || oldData.map.cols !== data.map.cols
      || oldData.fog !== data.fog
      || oldData.visibleTileIds !== data.visibleTileIds
      || oldData.tokens !== data.tokens;
    if (rebuildTiles) this.rebuildWorld();
    else {
      if (oldData.gridLines !== data.gridLines) this.buildGridLines();
      if (oldData.measureBox !== data.measureBox) this.buildMeasureBox();
      if (oldData.edges !== data.edges) this.buildEdges();
      if (oldData.footprints !== data.footprints) this.buildFootprints();
      // A measure-only update leaves the existing tile highlights intact.
      if (oldData.measureBox === data.measureBox
        || oldData.selectedTileIds !== data.selectedTileIds
        || oldData.routeTileIds !== data.routeTileIds
        || oldData.reachableTileIds !== data.reachableTileIds) this.rebuildOverlays();
    }
    if (!data.alignMode) this.clearAlignRect();
    if (data.alignMode) this.canvas.style.cursor = 'crosshair';
    else if (this.canvas.style.cursor === 'crosshair') this.canvas.style.cursor = '';
    this.applyCamera();
    this.saveCamera(this.data.map.id);
    this.needsRender = true;
  }

  resize(): void {
    if (!this.renderer) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect() ?? this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 1));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  frameActive(tileId: TileId | null): void {
    if (!this.data) return;
    const activePosition = tileId
      ? findTileGridPos(this.data.map, tileId)
      : null;
    const row = activePosition?.row ?? (this.data.map.rows - 1) / 2;
    const col = activePosition?.col ?? (this.data.map.cols - 1) / 2;
    this.cameraState = frameTiles(row, col, this.data.map.cols, this.data.map.rows);
    this.applyCamera();
    this.saveCamera(this.data.map.id);
    this.needsRender = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPendingEdgeClick();
    if (this.data) this.saveCamera(this.data.map.id);
    cancelAnimationFrame(this.animationFrame);
    this.unbindEvents();
    this.clearAlignRect();
    this.disposeWorld();
    for (const id of this.imageTextures.keys()) this.releaseImageTexture(id);
    for (const entry of this.tokenImageTextures.values()) entry.texture.dispose();
    this.tokenImageTextures.clear();
    this.footprintCheckerTexture?.dispose();
    this.footprintCheckerTexture = null;
    this.markerTexture?.dispose();
    this.markerTexture = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private readonly renderLoop = () => {
    if (this.disposed) return;
    if (this.needsRender && this.renderer && !this.contextLost) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
    this.animationFrame = requestAnimationFrame(this.renderLoop);
  };

  private bindEvents(): void {
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.();
  };

  private readonly onContextRestored = () => {
    this.contextLost = false;
    if (this.data) this.rebuildWorld();
    this.callbacks.onContextRestored?.();
    this.needsRender = true;
  };

  private readonly onContextMenu = (event: MouseEvent) => event.preventDefault();

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (!this.data) return;
    const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
    if ((event.ctrlKey || event.metaKey) && this.callbacks.onModifierWheel?.('brush', direction)) {
      return;
    }
    if (event.shiftKey && !event.ctrlKey && !event.metaKey
      && this.callbacks.onModifierWheel?.('elevation', direction)) {
      return;
    }
    this.cameraState = zoom(
      this.cameraState,
      event.deltaY > 0 ? 1.1 : 1 / 1.1,
      this.data.map.cols,
      this.data.map.rows
    );
    this.applyCamera();
    this.saveCamera(this.data.map.id);
    this.needsRender = true;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointerDrag = {
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragged: false,
      lastPaintedTileId: null,
      tokenFrom: null,
      alignStart: null,
      alignPlaneY: null,
    };
    if (event.button === 0 && this.data?.alignMode) {
      const { alignMode } = this.data;
      const hit = alignMode.planeFromPointerTile
        ? this.pickWithPoint(event.clientX, event.clientY)
        : null;
      this.pointerDrag.alignPlaneY = hit
        ? this.planeHeightForElevation(getEffectiveElevation(this.data.map, hit.entry.tileId))
        : this.alignPlaneHeight();
      const point = this.pickGroundPoint(event.clientX, event.clientY, this.pointerDrag.alignPlaneY);
      if (point) {
        this.pointerDrag.alignStart = point;
        this.beginAlignRect();
      }
    } else if (event.button === 0 && this.data?.paintModeActive) {
      const hit = this.pick(event.clientX, event.clientY);
      if (hit) {
        this.pointerDrag.lastPaintedTileId = hit.tileId;
        this.callbacks.onTilePaintStart(hit.tileId, hit.row, hit.col, event);
      }
    } else if (event.button === 0 && this.callbacks.onTokenDragStart) {
      const hit = this.pick(event.clientX, event.clientY);
      if (hit && this.callbacks.onTokenDragStart(hit.tileId, hit.row, hit.col)) {
        this.pointerDrag.tokenFrom = hit;
        this.canvas.style.cursor = 'grabbing';
      }
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const drag = this.pointerDrag;
    if (!drag) {
      this.updateHover(event.clientX, event.clientY);
      return;
    }
    const totalDx = event.clientX - drag.startX;
    const totalDy = event.clientY - drag.startY;
    if (Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) drag.dragged = true;

    if (drag.alignStart) {
      const point = this.pickGroundPoint(event.clientX, event.clientY, drag.alignPlaneY ?? this.alignPlaneHeight());
      if (point) this.updateAlignRect(drag.alignStart, point);
    } else if (drag.button === 0 && this.data?.paintModeActive) {
      const hit = this.pick(event.clientX, event.clientY);
      if (hit && hit.tileId !== drag.lastPaintedTileId) {
        drag.lastPaintedTileId = hit.tileId;
        this.callbacks.onTilePaintEnter(hit.tileId, hit.row, hit.col, event);
      }
    } else if (drag.tokenFrom) {
      // Token drag: the hover ring tracks the drop target; the camera stays put.
      this.updateHover(event.clientX, event.clientY);
    } else if (drag.dragged && this.data) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      // Right-drag grab-pans the map; middle (scroll-wheel click) drag orbits.
      // Left-drag is reserved for clicking, painting, and token dragging.
      if (drag.button === 1) {
        this.cameraState = orbit(
          this.cameraState,
          -dx * 0.008,
          dy * 0.008,
          this.data.map.cols,
          this.data.map.rows
        );
      } else if (drag.button === 2) {
        this.cameraState = dragPan(
          this.cameraState,
          dx,
          dy,
          Math.max(1, this.canvas.clientHeight),
          CAMERA_FOV,
          this.data.map.cols,
          this.data.map.rows
        );
      }
      this.applyCamera();
      this.needsRender = true;
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const drag = this.pointerDrag;
    this.pointerDrag = null;
    if (!drag) return;
    this.canvas.releasePointerCapture?.(event.pointerId);
    if (drag.tokenFrom) this.canvas.style.cursor = '';
    if (drag.alignStart) {
      const point = this.pickGroundPoint(event.clientX, event.clientY, drag.alignPlaneY ?? this.alignPlaneHeight());
      this.clearAlignRect();
      // alignMode may have been cancelled (Esc) mid-drag — don't report then.
      if (point && this.data?.alignMode) {
        this.callbacks.onAlignBoxComplete?.({
          x: Math.min(drag.alignStart.x, point.x),
          y: Math.min(drag.alignStart.z, point.z),
          width: Math.abs(point.x - drag.alignStart.x),
          height: Math.abs(point.z - drag.alignStart.z),
        });
      }
    } else if (drag.tokenFrom && drag.dragged) {
      const hit = this.pick(event.clientX, event.clientY);
      if (hit && hit.tileId !== drag.tokenFrom.tileId) {
        this.callbacks.onTokenDrop?.(drag.tokenFrom, hit);
      }
    } else if (!drag.dragged && !(drag.button === 0 && this.data?.paintModeActive)) {
      const hit = this.pick(event.clientX, event.clientY);
      const edge = drag.button === 0 && this.data?.edges ? this.pickEdge(event.clientX, event.clientY) : null;
      if (edge && this.callbacks.onEdgeClick) {
        // Defer so a double-click on the same edge does not also toggle it.
        if (this.pendingEdgeClick) clearTimeout(this.pendingEdgeClick);
        const pointerEvent = event;
        this.pendingEdgeClick = setTimeout(() => {
          this.pendingEdgeClick = null;
          const consumed = this.callbacks.onEdgeClick?.(edge, pointerEvent) ?? false;
          if (!consumed && hit) this.callbacks.onTileClick(hit.tileId, hit.row, hit.col, pointerEvent);
        }, 250);
      } else if (hit && drag.button === 0) {
        this.callbacks.onTileClick(hit.tileId, hit.row, hit.col, event);
      } else if (hit && drag.button === 2) {
        this.callbacks.onTileContextMenu(hit.tileId, hit.row, hit.col, event);
      }
    }
    if (this.data) this.saveCamera(this.data.map.id);
    this.updateHover(event.clientX, event.clientY);
  };

  private readonly onPointerLeave = () => {
    if (!this.pointerDrag) this.setHoveredTile(null, 0, 0);
    this.clearEdgeHover();
  };

  private updateHover(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY);
    this.setHoveredTile(hit, clientX, clientY);
    this.updateEdgeHover(clientX, clientY);
  }

  private readonly onDoubleClick = (event: MouseEvent) => {
    this.clearPendingEdgeClick();
    if (!this.data?.edges || this.data.alignMode || event.button !== 0) return;
    const edge = this.pickEdge(event.clientX, event.clientY);
    if (!edge) return;
    event.preventDefault();
    this.callbacks.onEdgeDoubleClick?.(edge);
  };

  private pickWithPoint(clientX: number, clientY: number): { entry: PickEntry; x: number; z: number } | null {
    if (!this.tileMesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.tileMesh, false)[0];
    if (hit?.instanceId === undefined) return null;
    const entry = this.pickEntries[hit.instanceId];
    return entry ? { entry, x: hit.point.x, z: hit.point.z } : null;
  }

  /** Nearest tile side within EDGE_PICK_BAND of the pointer, as the two tiles it separates. */
  private pickEdge(clientX: number, clientY: number): EdgePick | null {
    if (!this.data) return null;
    const hit = this.pickWithPoint(clientX, clientY);
    if (!hit) return null;
    const fx = hit.x - hit.entry.col;
    const fz = hit.z - hit.entry.row;
    const candidates: Array<[distance: number, dr: number, dc: number]> = [
      [fx, 0, -1], [1 - fx, 0, 1], [fz, -1, 0], [1 - fz, 1, 0],
    ];
    candidates.sort((p, q) => p[0] - q[0]);
    const [distance, dr, dc] = candidates[0];
    if (distance > EDGE_PICK_BAND) return null;
    const row = hit.entry.row + dr;
    const col = hit.entry.col + dc;
    if (row < 0 || col < 0 || row >= this.data.map.rows || col >= this.data.map.cols) return null;
    const neighbour = this.data.map.grid[row][col];
    return { a: hit.entry.tileId, b: neighbour, key: edgeKey(hit.entry.tileId, neighbour) };
  }

  private updateEdgeHover(clientX: number, clientY: number): void {
    if (!this.data?.edges) return;
    const edge = this.pickEdge(clientX, clientY);
    const key = edge?.key ?? null;
    if (key === this.edgeHoverKey) return;
    this.edgeHoverKey = key;
    if (this.edgeHover) {
      this.disposeGroup(this.edgeHover);
      this.edgeHover = null;
    }
    if (edge) {
      const mesh = this.edgeMesh(edge.key, { kind: 'hover' });
      if (mesh) {
        this.edgeHover = mesh;
        this.scene.add(mesh);
      }
    }
    this.needsRender = true;
  }

  /** World-space placement of an edge: center, along-axis, and the floor height under it. */
  private edgePlacement(key: EdgeKey): EdgePlacement | null {
    if (!this.data) return null;
    const [a, b] = splitEdgeKey(key);
    const pa = findTileGridPos(this.data.map, a);
    const pb = findTileGridPos(this.data.map, b);
    if (!pa || !pb) return null;
    const vertical = pa.row === pb.row; // same row → the shared side runs along z
    const x = vertical ? Math.max(pa.col, pb.col) : pa.col + 0.5;
    const z = vertical ? pa.row + 0.5 : Math.max(pa.row, pb.row);
    const y = Math.max(this.tileHeight(a), this.tileHeight(b));
    return { x, z, vertical, y };
  }

  private edgeMesh(edge: EdgeKey | EdgePlacement, state: EdgeState | { kind: 'hover' }): THREE.Group | null {
    const placement = typeof edge === 'string' ? this.edgePlacement(edge) : edge;
    if (!placement) return null;
    let color = '#4a3728';
    let length = 1;
    let height = WALL_HEIGHT;
    let thickness = 0.08;
    let gap = 0;
    if (state.kind === 'hover') {
      color = '#ffffff';
      thickness = 0.14;
      height = 0.06;
    } else if (state.kind === 'wall') {
      color = state.layerIds.length >= 2 ? '#7c5a3c' : state.derived ? '#4a3728' : '#3f4f6b';
    } else if (state.kind === 'door') {
      color = state.state === 'locked' ? '#dc2626' : '#d97706';
      thickness = 0.12;
      height = 0.26;
      length = 0.7;
      if (state.state === 'open') gap = 0.5;
    } else {
      return null;
    }
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: state.kind === 'hover',
      opacity: state.kind === 'hover' ? 0.7 : 1,
      depthWrite: state.kind !== 'hover',
    });
    const build = (segmentLength: number, offset: number) => {
      const geometry = new THREE.BoxGeometry(segmentLength, height, thickness);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        placement.x + (placement.vertical ? 0 : offset),
        placement.y + height / 2,
        placement.z + (placement.vertical ? offset : 0)
      );
      if (placement.vertical) mesh.rotation.y = Math.PI / 2;
      return mesh;
    };
    const group = new THREE.Group();
    if (gap === 0) {
      group.add(build(length, 0));
      return group;
    }
    // Open door: two stubs with a gap between them.
    const stub = (length - gap) / 2;
    group.add(build(stub, -(gap / 2 + stub / 2)));
    group.add(build(stub, gap / 2 + stub / 2));
    return group;
  }

  private clearPendingEdgeClick(): void {
    if (this.pendingEdgeClick !== null) clearTimeout(this.pendingEdgeClick);
    this.pendingEdgeClick = null;
  }

  private clearEdgeHover(): void {
    if (this.edgeHover) this.disposeGroup(this.edgeHover);
    this.edgeHover = null;
    this.edgeHoverKey = null;
    this.needsRender = true;
  }

  private buildEdges(): void {
    if (this.edgeGroup) this.disposeGroup(this.edgeGroup);
    this.edgeGroup = null;
    this.clearEdgeHover();
    if (!this.data || (!this.data.edges && !isTacticalScale(this.data.map.scale))) return;
    const group = new THREE.Group();
    group.name = 'edges';
    for (const [key, state] of this.data.edges ?? []) {
      const [a, b] = splitEdgeKey(key);
      if (!this.tileIsRendered(a) && !this.tileIsRendered(b)) continue;
      const mesh = this.edgeMesh(key, state);
      if (mesh) {
        mesh.name = key;
        group.add(mesh);
      }
    }
    if (isTacticalScale(this.data.map.scale)) {
      const { rows, cols } = this.data.map;
      for (const { tileId, row, col } of this.pickEntries) {
        const y = this.tileHeight(tileId);
        const placements: EdgePlacement[] = [];
        if (row === 0) placements.push({ x: col + 0.5, z: row, vertical: false, y });
        if (row === rows - 1) placements.push({ x: col + 0.5, z: row + 1, vertical: false, y });
        if (col === 0) placements.push({ x: col, z: row + 0.5, vertical: true, y });
        if (col === cols - 1) placements.push({ x: col + 1, z: row + 0.5, vertical: true, y });
        for (const placement of placements) {
          const wall = this.edgeMesh(placement, { kind: 'wall', derived: true, layerIds: [] });
          if (wall) {
            wall.name = 'boundary-wall';
            group.add(wall);
          }
        }
      }
    }
    this.edgeGroup = group;
    this.scene.add(group);
  }

  private checkerTexture(): THREE.CanvasTexture {
    if (this.footprintCheckerTexture) return this.footprintCheckerTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#facc15';
      context.fillRect(0, 0, 4, 4);
      context.fillStyle = '#111827';
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) if ((x + y) % 2 === 0) context.fillRect(x, y, 1, 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    this.footprintCheckerTexture = texture;
    return texture;
  }

  private buildFootprints(): void {
    if (this.footprintGroup) {
      this.disposeGroup(this.footprintGroup);
      this.footprintGroup = null;
    }
    if (!this.data?.footprints || this.data.fog !== 'gm') return;
    const { map } = this.data;
    const group = new THREE.Group();
    group.name = 'footprints';
    const index = indexFootprints(map);
    const layers = map.imageLayers ?? [];

    // Footprint tints (one color per layer) + editable box outline for the layer being edited.
    layers.forEach((layer, layerIndex) => {
      if (!layer.footprint) return;
      const editing = this.data?.footprints?.editingLayerId === layer.id;
      if (!editing && !this.data?.footprints?.showTints) return;
      const color = FOOTPRINT_PALETTE[layerIndex % FOOTPRINT_PALETTE.length];
      const tiles = index.byLayer.get(layer.id);
      if (!tiles) return;
      const geometry = new THREE.PlaneGeometry(0.98, 0.98);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: editing ? 0.45 : 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, tiles.size);
      const dummy = new THREE.Object3D();
      let cursor = 0;
      for (const tileId of tiles) {
        const position = findTileGridPos(map, tileId);
        if (!position) continue;
        dummy.position.set(position.col + 0.5, this.tileHeight(tileId) + 0.03, position.row + 0.5);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(cursor, dummy.matrix);
        cursor += 1;
      }
      mesh.count = cursor;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.renderOrder = FOOTPRINT_TINT_RENDER_ORDER;
      group.add(mesh);

      if (editing) {
        const anchor = layerAnchor(layer);
        const w = Math.round(layer.width);
        const h = Math.round(layer.height);
        const y = Math.max(layer.elevation * TILE_LIFT, BASE_PLATE) + 0.05;
        const points = new Float32Array([
          anchor.col, y, anchor.row, anchor.col + w, y, anchor.row,
          anchor.col + w, y, anchor.row, anchor.col + w, y, anchor.row + h,
          anchor.col + w, y, anchor.row + h, anchor.col, y, anchor.row + h,
          anchor.col, y, anchor.row + h, anchor.col, y, anchor.row,
        ]);
        const outlineGeometry = new THREE.BufferGeometry();
        outlineGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
        const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false }));
        outline.renderOrder = 1500;
        group.add(outline);
      }
    });

    // Overlap checkerboard (Czepeku's cue).
    if (index.overlap.size > 0) {
      const geometry = new THREE.PlaneGeometry(0.98, 0.98);
      const material = new THREE.MeshBasicMaterial({
        map: this.checkerTexture(),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, index.overlap.size);
      const dummy = new THREE.Object3D();
      let cursor = 0;
      for (const tileId of index.overlap) {
        const position = findTileGridPos(map, tileId);
        if (!position) continue;
        dummy.position.set(position.col + 0.5, this.tileHeight(tileId) + 0.04, position.row + 0.5);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(cursor, dummy.matrix);
        cursor += 1;
      }
      mesh.count = cursor;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.renderOrder = FOOTPRINT_CHECKER_RENDER_ORDER;
      group.add(mesh);
    }

    this.footprintGroup = group;
    this.scene.add(group);
  }

  private setHoveredTile(hit: PickEntry | null, clientX: number, clientY: number): void {
    if ((hit?.tileId ?? null) === this.hoveredTileId) {
      if (hit) this.callbacks.onHoverTile({ ...hit, clientX, clientY });
      return;
    }
    this.hoveredTileId = hit?.tileId ?? null;
    this.callbacks.onHoverTile(hit ? { ...hit, clientX, clientY } : null);
    this.rebuildOverlays();
    this.needsRender = true;
  }

  private pick(clientX: number, clientY: number): PickEntry | null {
    if (!this.tileMesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.tileMesh, false)[0];
    if (hit?.instanceId === undefined) return null;
    return this.pickEntries[hit.instanceId] ?? null;
  }

  /** Height of the plane the align box is drawn on (same floor formula as image layers). */
  private alignPlaneHeight(): number {
    return this.planeHeightForElevation(this.data?.alignMode?.elevation ?? 0);
  }

  private planeHeightForElevation(elevation: number): number {
    return Math.max(elevation * TILE_LIFT, BASE_PLATE) + 0.02;
  }

  /** Intersect the pointer ray with the horizontal align plane → fractional world coords. */
  private pickGroundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target)
      ? { x: target.x, z: target.z }
      : null;
  }

  private beginAlignRect(): void {
    this.clearAlignRect();
    const group = new THREE.Group();

    // Translucent fill spanning 0..1 in x/z so nonuniform group scale shapes it.
    const fillGeometry = new THREE.PlaneGeometry(1, 1);
    fillGeometry.rotateX(-Math.PI / 2);
    fillGeometry.translate(0.5, 0, 0.5);
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      color: '#60a5fa',
      transparent: true,
      opacity: 0.18,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    fill.renderOrder = 2000;
    group.add(fill);

    // 3×3 cell lines so the user can match them against the image's printed grid.
    const points: number[] = [];
    for (let index = 0; index <= ALIGN_BOX_CELLS; index += 1) {
      const t = index / ALIGN_BOX_CELLS;
      points.push(t, 0, 0, t, 0, 1);
      points.push(0, 0, t, 1, 0, t);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      color: '#93c5fd',
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }));
    lines.renderOrder = 2001;
    group.add(lines);

    group.position.y = this.pointerDrag?.alignPlaneY ?? this.alignPlaneHeight();
    group.visible = false;
    this.alignRectGroup = group;
    this.scene.add(group);
  }

  private updateAlignRect(start: { x: number; z: number }, current: { x: number; z: number }): void {
    const group = this.alignRectGroup;
    if (!group) return;
    const width = Math.abs(current.x - start.x);
    const depth = Math.abs(current.z - start.z);
    group.visible = width > 0.01 && depth > 0.01;
    group.position.x = Math.min(start.x, current.x);
    group.position.z = Math.min(start.z, current.z);
    group.scale.set(Math.max(width, 0.001), 1, Math.max(depth, 0.001));
    this.needsRender = true;
  }

  private clearAlignRect(): void {
    if (!this.alignRectGroup) return;
    this.disposeGroup(this.alignRectGroup);
    this.alignRectGroup = null;
    this.needsRender = true;
  }

  private restoreOrFrameCamera(): void {
    if (!this.data) return;
    try {
      const raw = localStorage.getItem(`vtt_cam_${this.data.map.id}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (this.isCameraState(parsed)) {
          this.cameraState = clampCamera(parsed, this.data.map.cols, this.data.map.rows);
          return;
        }
      }
    } catch {
      // Storage is optional (private mode and sandboxed contexts may reject it).
    }
    this.frameActive(null);
  }

  private saveCamera(mapId: string): void {
    try {
      localStorage.setItem(`vtt_cam_${mapId}`, JSON.stringify(this.cameraState));
    } catch {
      // Camera persistence is best effort.
    }
  }

  private isCameraState(value: unknown): value is CameraState {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return ['azimuth', 'elevation', 'distance', 'targetX', 'targetZ']
      .every((key) => typeof candidate[key] === 'number');
  }

  private applyCamera(): void {
    const [x, y, z] = cameraPosition(this.cameraState);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cameraState.targetX, 0, this.cameraState.targetZ);
    this.camera.updateMatrixWorld();
  }

  private buildGridLines(): void {
    this.disposeGroup(this.gridGroup);
    this.gridGroup = null;
    if (!this.data?.gridLines || !isTacticalScale(this.data.map.scale)) return;
    const points: number[] = [];
    for (const { tileId, row, col } of this.pickEntries) {
      const y = this.tileHeight(tileId) + 0.012;
      const x0 = col, x1 = col + 1, z0 = row, z1 = row + 1;
      points.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1,
        x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: '#05070a', transparent: true, opacity: 0.75, depthWrite: false,
    }));
    lines.renderOrder = GRID_LINE_RENDER_ORDER;
    const group = new THREE.Group();
    group.name = 'grid-lines';
    group.add(lines);
    this.gridGroup = group;
    this.scene.add(group);
  }

  private rebuildWorld(): void {
    if (!this.data) return;
    this.disposeWorld();
    this.buildTiles();
    this.buildStructures();
    this.buildImageLayers();
    this.buildGridLines();
    this.buildFootprints();
    this.buildMeasureBox();
    this.buildEdges();
    this.buildMarkersAndLinks();
    this.buildTokens();
    this.rebuildOverlays();
  }

  private tileIsRendered(tileId: TileId): boolean {
    if (!this.data) return false;
    if (this.data.fog !== 'player-los') return true;
    return this.data.visibleTileIds?.has(tileId) === true
      || this.data.map.revealedTileIds.has(tileId);
  }

  private tileHeight(tileId: TileId): number {
    if (!this.data) return BASE_PLATE;
    return Math.max(getEffectiveElevation(this.data.map, tileId) * TILE_LIFT, BASE_PLATE);
  }

  private buildTiles(): void {
    if (!this.data) return;
    const entries: PickEntry[] = [];
    for (let row = 0; row < this.data.map.rows; row += 1) {
      for (let col = 0; col < this.data.map.cols; col += 1) {
        const tileId = this.data.map.grid[row][col];
        if (this.tileIsRendered(tileId)) entries.push({ tileId, row, col });
      }
    }

    const geometry = this.createTileGeometry();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    this.renderedTileIds = new Set();

    entries.forEach((entry, index) => {
      const height = this.tileHeight(entry.tileId);
      dummy.position.set(entry.col + 0.5, height, entry.row + 0.5);
      dummy.scale.set(0.98, height, 0.98);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      this.setTileColor(color, entry.tileId);
      mesh.setColorAt(index, color);
      this.renderedTileIds.add(entry.tileId);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.tileMesh = mesh;
    this.pickEntries = entries;
    this.scene.add(mesh);
  }

  private createTileGeometry(): THREE.BufferGeometry {
    const indexed = new THREE.BoxGeometry(1, 1, 1);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.translate(0, -0.5, 0);
    const normals = geometry.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    for (let index = 0; index < normals.count; index += 1) {
      const factor = Math.abs(normals.getY(index)) > 0.5
        ? 1
        : Math.abs(normals.getX(index)) > 0.5 ? 0.62 : 0.45;
      colors[index * 3] = factor;
      colors[index * 3 + 1] = factor;
      colors[index * 3 + 2] = factor;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  private setTileColor(color: THREE.Color, tileId: TileId): void {
    if (!this.data) return;
    const tile = this.data.map.tilesById[tileId];
    const terrain = tile?.terrainId ? this.data.map.terrainById[tile.terrainId] : null;
    this.setTerrainColorWithFog(color, terrain?.color ?? '#1f2937', tileId);
  }

  private setTerrainColorWithFog(color: THREE.Color, style: string, tileId: TileId): void {
    if (!this.data) return;
    color.setStyle(style);
    if (this.data.fog === 'gm' && !this.data.map.revealedTileIds.has(tileId)) {
      color.multiplyScalar(0.4);
    } else if (
      this.data.fog === 'player-los'
      && !this.data.visibleTileIds?.has(tileId)
      && this.data.map.revealedTileIds.has(tileId)
    ) {
      const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      color.lerp(new THREE.Color(luminance, luminance, luminance), 0.7).multiplyScalar(0.5);
    }
  }

  private buildStructures(): void {
    if (!this.data) return;
    const cells: Array<{ row: number; col: number; terrainId: TerrainId; base: number; height: number }> = [];
    for (const layer of this.data.map.structureLayers ?? []) {
      if (!layer.visible) continue;
      for (const [tileId, terrainId] of Object.entries(layer.cells)) {
        if (!this.renderedTileIds.has(tileId)) continue;
        const position = findTileGridPos(this.data.map, tileId);
        if (!position) continue;
        cells.push({
          ...position,
          terrainId,
          base: layer.baseElevation,
          height: Math.max(1, layer.heightLevels),
        });
      }
    }
    if (cells.length === 0) return;

    const geometry = this.createTileGeometry();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    cells.forEach((cell, index) => {
      const top = (cell.base + cell.height) * TILE_LIFT;
      dummy.position.set(cell.col + 0.5, top, cell.row + 0.5);
      dummy.scale.set(0.98, cell.height * TILE_LIFT, 0.98);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      const tileId = this.data!.map.grid[cell.row][cell.col];
      const terrain = this.data!.map.terrainById[cell.terrainId];
      this.setTerrainColorWithFog(color, terrain?.color ?? '#6b7280', tileId);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.structureMesh = mesh;
    this.scene.add(mesh);
  }

  private imageLayerIsRendered(layer: MapImageLayer): boolean {
    if (!this.data || !layer.visible) return false;
    // Player LOS fog can't clip an image plane, so images would leak hidden
    // map areas — skip them entirely in that regime.
    if (this.data.fog === 'player-los') return false;
    if (layer.gmOnly && this.data.fog !== 'gm') return false;
    return true;
  }

  private releaseImageTexture(id: string): void {
    const entry = this.imageTextures.get(id);
    if (!entry) return;
    this.imageTextures.delete(id);
    entry.texture?.dispose();
    if (entry.assetId && ![...this.imageTextures.values()].some((other) => other.assetId === entry.assetId)) {
      this.assetStore.releaseObjectUrl(entry.assetId);
    }
  }

  private getImageTexture(layer: MapImageLayer): THREE.Texture | null {
    const key = layer.assetId ?? layer.src ?? '';
    const cached = this.imageTextures.get(layer.id);
    if (cached?.key === key) return cached.texture;
    this.releaseImageTexture(layer.id);
    const entry = { key, texture: null as THREE.Texture | null, assetId: layer.assetId };
    this.imageTextures.set(layer.id, entry);
    if (layer.assetId) {
      const assetId = layer.assetId;
      void this.assetStore.getObjectUrl(assetId).then((url) => {
        // Identity, rather than key alone, also guards remove/re-add of the same layer.
        if (this.imageTextures.get(layer.id) !== entry) return;
        if (!url) {
          if (!this.missingImageAssets.has(assetId)) {
            this.missingImageAssets.add(assetId);
            console.warn('[MapScene] Missing image asset', assetId);
          }
          return;
        }
        const texture = new THREE.TextureLoader().load(url, () => {
          if (this.imageTextures.get(layer.id) !== entry) return;
          this.buildImageLayers();
          this.needsRender = true;
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        entry.texture = texture;
        this.buildImageLayers();
        this.needsRender = true;
      }).catch((error: unknown) => {
        if (this.imageTextures.get(layer.id) === entry) console.warn('[MapScene] Failed to resolve image asset', assetId, error);
      });
      return null;
    }
    if (!layer.src) return null;
    const texture = new THREE.TextureLoader().load(layer.src, () => {
      if (this.imageTextures.get(layer.id) === entry) this.needsRender = true;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    entry.texture = texture;
    return texture;
  }

  private clearImageLayers(): void {
    if (!this.imageGroup) return;
    this.scene.remove(this.imageGroup);
    this.imageGroup.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        this.disposeMaterial(object.material);
      }
    });
    this.imageGroup = null;
  }

  private buildMeasureBox(): void {
    this.disposeGroup(this.measureGroup);
    this.measureGroup = null;
    if (!this.data?.measureBox || this.data.fog !== 'gm') return;
    const { col, row, width, height } = this.data.measureBox;
    const map = this.data.map;
    let floor = BASE_PLATE;
    for (let r = Math.max(0, row); r < Math.min(map.rows, row + height); r++) {
      for (let c = Math.max(0, col); c < Math.min(map.cols, col + width); c++) {
        floor = Math.max(floor, this.tileHeight(map.grid[r][c]));
        for (const layer of map.structureLayers ?? []) {
          if (layer.visible && layer.cells[map.grid[r][c]]) {
            floor = Math.max(floor, (layer.baseElevation + Math.max(1, layer.heightLevels)) * TILE_LIFT);
          }
        }
      }
    }
    const group = new THREE.Group();
    group.name = 'measureBox';
    const material = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true,
      opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(col + width / 2, floor + 0.02, row + height / 2);
    plane.renderOrder = 2000;
    group.add(plane);
    const outline = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
    const bar = (w: number, h: number, x: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), outline);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, floor + 0.02, z);
      mesh.renderOrder = 2001;
      group.add(mesh);
    };
    bar(width + 0.06, 0.06, col + width / 2, row);
    bar(width + 0.06, 0.06, col + width / 2, row + height);
    bar(0.06, height, col, row + height / 2);
    bar(0.06, height, col + width, row + height / 2);
    this.measureGroup = group;
    this.scene.add(group);
  }

  private buildImageLayers(): void {
    this.clearImageLayers();
    if (!this.data) return;
    const layers = (this.data.map.imageLayers ?? []).filter((layer) => this.imageLayerIsRendered(layer));
    // Release removed or changed layers, including layers currently hidden by visibility/fog.
    const liveKeys = new Map((this.data.map.imageLayers ?? []).map((layer) => [layer.id, layer.assetId ?? layer.src ?? '']));
    for (const [id, entry] of this.imageTextures) {
      if (liveKeys.get(id) !== entry.key) this.releaseImageTexture(id);
    }
    if (layers.length === 0) return;

    const group = new THREE.Group();
    layers.forEach((layer, index) => {
      const texture = this.getImageTexture(layer);
      if (!texture) return;
      const overlay = layer.placement === 'overlay';
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: Math.max(0, Math.min(1, layer.opacity)),
        depthWrite: false,
        depthTest: !overlay,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const rotation = normalizeRotation(layer.rotation);
      const quarterTurn = rotation === 90 || rotation === 270;
      const imgW = quarterTurn ? layer.height : layer.width;
      const imgH = quarterTurn ? layer.width : layer.height;
      // Local +y becomes world -z; negative local Z rotation is clockwise on the grid.
      // Scale applies image-space mirrors before the Euler rotation.
      plane.rotation.set(-Math.PI / 2, 0, -rotation * Math.PI / 180);
      plane.scale.set(imgW * (layer.mirrorX ? -1 : 1), imgH * (layer.mirrorY ? -1 : 1), 1);
      // Skin the tops of tiles at this elevation (same floor formula as tileHeight),
      // so an underlay at the map's ground level draws over the ground tiles.
      plane.position.set(
        layer.x + layer.width / 2,
        Math.max(layer.elevation * TILE_LIFT, BASE_PLATE) + 0.01 + index * 0.001,
        layer.y + layer.height / 2
      );
      // Overlays skip the depth test; renderOrder keeps them above everything.
      plane.renderOrder = overlay ? 1000 + index : 0;
      group.add(plane);
    });
    this.imageGroup = group;
    this.scene.add(group);
  }

  private rebuildOverlays(): void {
    if (this.overlayMesh) {
      this.scene.remove(this.overlayMesh);
      this.overlayMesh.geometry.dispose();
      this.disposeMaterial(this.overlayMesh.material);
      this.overlayMesh = null;
    }
    if (!this.data) return;
    const route = new Set(this.data.routeTileIds ?? []);
    const highlights = new Map<TileId, string>();
    for (const tileId of this.data.reachableTileIds ?? []) highlights.set(tileId, '#22c55e');
    for (const tileId of this.data.selectedTileIds ?? []) highlights.set(tileId, '#facc15');
    for (const tileId of route) highlights.set(tileId, '#60a5fa');
    if (this.hoveredTileId && !highlights.has(this.hoveredTileId)) {
      highlights.set(this.hoveredTileId, '#ffffff');
    }
    const entries = Array.from(highlights).filter(([tileId]) => this.renderedTileIds.has(tileId));
    if (entries.length === 0) return;

    const geometry = new THREE.PlaneGeometry(0.94, 0.94);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: this.hoveredTileId && entries.length === 1 ? 0.25 : 0.4,
      depthWrite: false,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    entries.forEach(([tileId, style], index) => {
      const position = findTileGridPos(this.data!.map, tileId);
      if (!position) return;
      dummy.position.set(position.col + 0.5, this.tileHeight(tileId) + 0.02, position.row + 0.5);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, color.setStyle(style));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.overlayMesh = mesh;
    this.scene.add(mesh);
  }

  private buildTokens(): void {
    if (!this.data) return;
    const tokens = this.data.tokens ?? [];
    const liveImageTokenIds = new Set(
      tokens.filter((token) => Boolean(token.image)).map((token) => token.id)
    );
    for (const [id, entry] of this.tokenImageTextures) {
      if (!liveImageTokenIds.has(id)) {
        entry.texture.dispose();
        this.tokenImageTextures.delete(id);
      }
    }
    if (tokens.length === 0) return;
    const group = new THREE.Group();
    const byTile = new Map<TileId, MapToken[]>();
    for (const token of tokens) {
      byTile.set(token.tileId, [...(byTile.get(token.tileId) ?? []), token]);
    }
    for (const [tileId, tokens] of byTile) {
      if (!this.renderedTileIds.has(tileId)) continue;
      const position = findTileGridPos(this.data.map, tileId);
      if (!position) continue;
      const height = this.tileHeight(tileId);
      const offsets = tokenOffsets(tokens.length);
      tokens.forEach((token, index) => {
        const { dx, dz } = offsets[index];
        const x = position.col + 0.5 + dx;
        const z = position.row + 0.5 + dz;
        const opacity = token.dimmed ? 0.45 : 1;
        const radius = token.isCurrent ? 0.25 : token.kind === 'vehicle' ? 0.23 : 0.2;
        if (token.image) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.getTokenImageTexture(token.id, token.image, token.color),
            transparent: true,
            opacity,
            depthWrite: false,
          }));
          sprite.position.set(x, height + radius + 0.06, z);
          sprite.scale.set(radius * 2.15, radius * 2.15, 1);
          group.add(sprite);
        } else {
          const geometry = token.kind === 'vehicle'
            ? new THREE.BoxGeometry(radius * 1.8, radius * 1.35, radius * 1.8)
            : new THREE.SphereGeometry(radius, 16, 12);
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: token.color, transparent: opacity < 1, opacity })
          );
          mesh.position.set(x, height + radius * 0.75, z);
          group.add(mesh);
          if (token.label) {
            const labelTexture = this.createLabelTexture(token.label, token.color);
            const labelMaterial = new THREE.SpriteMaterial({
              map: labelTexture,
              transparent: true,
              opacity,
              depthWrite: false,
            });
            labelMaterial.userData.disposeMap = true;
            const label = new THREE.Sprite(labelMaterial);
            label.position.set(x, height + radius * 2.35, z);
            label.scale.set(0.38, 0.38, 1);
            group.add(label);
          }
        }
        if (token.isCurrent || token.isSelected) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius + 0.04, radius + 0.12, 24),
          new THREE.MeshBasicMaterial({
            color: token.isCurrent ? '#ffffff' : '#facc15',
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, height + 0.015, z);
        group.add(ring);
        }
      });
    }
    if (group.children.length > 0) {
      this.tokenGroup = group;
      this.scene.add(group);
    }
  }

  private getTokenImageTexture(id: string, src: string, rimColor: string): THREE.CanvasTexture {
    const cached = this.tokenImageTextures.get(id);
    if (cached?.src === src) return cached.texture;
    if (cached) cached.texture.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.tokenImageTextures.set(id, { src, texture });
    if (context) {
      const image = new Image();
      image.onload = () => {
        context.clearRect(0, 0, 96, 96);
        context.save();
        context.beginPath();
        context.arc(48, 48, 43, 0, Math.PI * 2);
        context.clip();
        const scale = Math.max(86 / image.naturalWidth, 86 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height);
        context.restore();
        context.beginPath();
        context.arc(48, 48, 44, 0, Math.PI * 2);
        context.strokeStyle = rimColor;
        context.lineWidth = 4;
        context.stroke();
        texture.needsUpdate = true;
        this.needsRender = true;
      };
      image.src = src;
    }
    return texture;
  }

  private createLabelTexture(label: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fillStyle = '#111827';
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = '#ffffff';
      context.font = 'bold 27px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label.slice(0, 2), 32, 34);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildMarkersAndLinks(): void {
    if (!this.data) return;
    const markerGroup = new THREE.Group();
    const markerMaterial = new THREE.SpriteMaterial({ map: this.getMarkerTexture() });
    const linkGroup = new THREE.Group();
    const linkGeometry = new THREE.OctahedronGeometry(0.12);
    const linkMaterial = new THREE.MeshBasicMaterial({ color: '#22d3ee' });

    for (let row = 0; row < this.data.map.rows; row += 1) {
      for (let col = 0; col < this.data.map.cols; col += 1) {
        const tileId = this.data.map.grid[row][col];
        if (!this.renderedTileIds.has(tileId)) continue;
        const tile = this.data.map.tilesById[tileId];
        if (!tile) continue;
        const visibleMarkers = tile.markerIds.some((markerId) => {
          const marker = this.data?.map.markersById[markerId];
          return marker && (this.data?.fog === 'gm' || marker.visibility === 'player');
        });
        const height = this.tileHeight(tileId);
        if (visibleMarkers) {
          const sprite = new THREE.Sprite(markerMaterial);
          sprite.center.set(0.5, 0);
          sprite.position.set(col + 0.5, height + 0.02, row + 0.5);
          sprite.scale.set(0.5, 0.65, 1);
          markerGroup.add(sprite);
        }
        if (tile.linkIds.length > 0) {
          const link = new THREE.Mesh(linkGeometry, linkMaterial);
          link.position.set(col + 0.8, height + 0.3, row + 0.8);
          linkGroup.add(link);
        }
      }
    }
    if (markerGroup.children.length > 0) {
      this.markerGroup = markerGroup;
      this.scene.add(markerGroup);
    } else {
      markerMaterial.dispose();
    }
    if (linkGroup.children.length > 0) {
      this.linkGroup = linkGroup;
      this.scene.add(linkGroup);
    } else {
      linkGeometry.dispose();
      linkMaterial.dispose();
    }
  }

  private getMarkerTexture(): THREE.CanvasTexture {
    if (this.markerTexture) return this.markerTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (context) {
      context.beginPath();
      context.moveTo(32, 74);
      context.lineTo(17, 42);
      context.arc(32, 29, 21, Math.PI * 0.8, Math.PI * 0.2, false);
      context.closePath();
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#111827';
      context.lineWidth = 5;
      context.fill();
      context.stroke();
      context.beginPath();
      context.arc(32, 29, 7, 0, Math.PI * 2);
      context.fillStyle = '#111827';
      context.fill();
    }
    this.markerTexture = new THREE.CanvasTexture(canvas);
    this.markerTexture.colorSpace = THREE.SRGBColorSpace;
    return this.markerTexture;
  }

  private disposeWorld(): void {
    this.disposeGroup(this.gridGroup);
    this.gridGroup = null;
    if (this.edgeGroup) this.disposeGroup(this.edgeGroup);
    this.edgeGroup = null;
    this.clearEdgeHover();
    if (this.tileMesh) {
      this.scene.remove(this.tileMesh);
      this.tileMesh.geometry.dispose();
      this.disposeMaterial(this.tileMesh.material);
      this.tileMesh = null;
    }
    if (this.overlayMesh) {
      this.scene.remove(this.overlayMesh);
      this.overlayMesh.geometry.dispose();
      this.disposeMaterial(this.overlayMesh.material);
      this.overlayMesh = null;
    }
    if (this.structureMesh) {
      this.scene.remove(this.structureMesh);
      this.structureMesh.geometry.dispose();
      this.disposeMaterial(this.structureMesh.material);
      this.structureMesh = null;
    }
    this.clearImageLayers();
    this.disposeGroup(this.measureGroup);
    this.measureGroup = null;
    this.disposeGroup(this.footprintGroup);
    this.footprintGroup = null;
    this.disposeGroup(this.markerGroup);
    this.disposeGroup(this.linkGroup);
    this.disposeGroup(this.tokenGroup);
    this.markerGroup = null;
    this.linkGroup = null;
    this.tokenGroup = null;
    this.pickEntries = [];
    this.renderedTileIds.clear();
  }

  private disposeGroup(group: THREE.Group | null): void {
    if (!group) return;
    this.scene.remove(group);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material) => materials.add(material));
      } else if (object instanceof THREE.Sprite) {
        materials.add(object.material);
        if (object.material.userData.disposeMap && object.material.map) object.material.map.dispose();
      } else if (object instanceof THREE.Line) {
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    group.clear();
  }

  private disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }
}
