"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Item, Project } from "@/lib/types";
const asset = (key: string) =>
  key.startsWith("/") ? key : "/api/assets?key=" + encodeURIComponent(key);
function box(
  g: THREE.Group,
  size: number[],
  pos: number[],
  color: string,
  radius = 0,
) {
  const geo = new RoundedBoxGeometry(size[0],size[1],size[2],3, radius || Math.min(...size)*0.16);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.68 }),
  );
  m.position.set(...(pos as [number, number, number]));
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function demoModel(kind: string) {
  const g = new THREE.Group();
  const wood = "#aa8461",
    dark = "#8c6b4e";
  if (kind === "bed") {
    box(g, [1.72, 0.19, 2.2], [0, 0.28, 0], wood);
    box(g, [1.66, 0.23, 2.08], [0, 0.49, 0], "#f0ede3");
    box(g, [1.69, 0.06, 1.42], [0, 0.64, 0.3], "#d9d5c7");
    box(g, [1.8, 0.9, 0.1], [0, 0.48, -1.08], wood);
    for (const x of [-0.77, 0.77])
      for (const z of [-0.95, 0.95])
        box(g, [0.09, 0.22, 0.09], [x, 0.11, z], dark);
    for (const x of [-0.43, 0.43])
      box(g, [0.65, 0.12, 0.4], [x, 0.655, -0.69], "#f7f3e9");
  } else if (kind === "desk") {
    box(g, [1.45, 0.07, 0.67], [0, 0.73, 0], wood);
    box(g, [1.25, 0.19, 0.57], [0, 0.6, 0], wood);
    for (const x of [-0.64, 0.64])
      for (const z of [-0.25, 0.25])
        box(g, [0.055, 0.72, 0.055], [x, 0.36, z], dark);
    box(g, [0.13, 0.015, 0.025], [0.3, 0.61, 0.299], "#5c5147");
  } else {
    box(g, [1.1, 2.02, 0.55], [0, 1.09, 0], wood);
    for (const x of [-0.275, 0.275])
      box(
        g,
        [0.535, 1.96, 0.035],
        [x, 1.1, 0.294],
        x < 0 ? "#b79470" : "#b08b65",
      );
    for (const x of [-0.035, 0.035])
      box(g, [0.014, 0.21, 0.025], [x, 1.03, 0.33], "#534638");
    for (const x of [-0.45, 0.45])
      for (const z of [-0.2, 0.2])
        box(g, [0.07, 0.16, 0.07], [x, 0.08, z], dark);
  }
  return g;
}
function demoRoom() {
  const g = new THREE.Group();
  box(g, [5.8, 0.14, 5.2], [0, -0.08, 0], "#bda88c");
  box(g, [0.12, 2.9, 5.2], [-2.95, 1.4, 0], "#e5e0d4");
  box(g, [5.8, 0.88, 0.12], [0, 0.38, -2.65], "#e5e0d4");
  box(g, [5.8, 0.45, 0.12], [0, 2.69, -2.65], "#e5e0d4");
  box(g, [1.1, 1.7, 0.12], [-2.35, 1.65, -2.65], "#e5e0d4");
  box(g, [1.5, 1.7, 0.12], [2.15, 1.65, -2.65], "#e5e0d4");
  box(g, [3.2, 1.65, 0.06], [-0.2, 1.66, -2.66], "#c6d1ca");
  for (const x of [-1.8, -0.2, 1.4])
    box(g, [0.045, 1.7, 0.1], [x, 1.66, -2.6], "#76786d");
  box(g, [3.3, 0.06, 0.17], [-0.2, 0.82, -2.57], "#d8d0c0");
  for (let x = -2.8; x < 2.9; x += 0.38) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.001, -2.6),
        new THREE.Vector3(x, 0.001, 2.6),
      ]),
      new THREE.LineBasicMaterial({
        color: "#a5947f",
        transparent: true,
        opacity: 0.25,
      }),
    );
    g.add(line);
  }
  return g;
}
type Props = {
  project: Project;
  selected: string | null;
  pending: string | null;
  reset: number;
  focus: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, pos: [number, number, number]) => void;
  onPlace: (id: string, pos: [number, number, number]) => void;
  onThumb: (id: string, url: string) => void;
  onError: (s: string) => void;
};
export default function Scene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const engine = useRef<any>(null);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e9ede5");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 150);
    camera.position.set(7.2, 6.1, 8.5);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "房间三维画布");
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.65, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 0.5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    scene.add(new THREE.HemisphereLight("#ffffff", "#9b8b76", 2.6));
    const sun = new THREE.DirectionalLight("#fff8eb", 3.5);
    sun.position.set(-2, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.normalBias = 0.025;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const fill = new THREE.DirectionalLight("#e6efdf", 1);
    fill.position.set(5, 3, -4);
    scene.add(fill);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: "#86907c",
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.visible = false;
    scene.add(plane);
    const grid = new THREE.GridHelper(6, 12, "#9b9d8d", "#c3c2b5");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    scene.add(grid);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.2, 40),
      new THREE.MeshBasicMaterial({
        color: "#688065",
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 100;
    scene.add(ring);
    const outline = new THREE.Box3Helper(
      new THREE.Box3(),
      new THREE.Color("#718569"),
    );
    (outline.material as THREE.Material).depthTest = false;
    outline.renderOrder = 100;
    outline.visible = false;
    scene.add(outline);
    const objects = new Map<string, THREE.Group>();
    const ray = new THREE.Raycaster();
    const pt = new THREE.Vector2();
    let dragging: string | null = null,
      start: [number, number, number] | null = null,
      pointerStart = [0, 0],
      dirty = true,
      frames = 0,
      room: THREE.Object3D | null = null,
      ghost: THREE.Group | null = null,
      ghostId = "";
    const mark = () => {
      dirty = true;
      frames = 8;
    };
    controls.addEventListener("change", mark);
    function floor(e: { clientX: number; clientY: number }) {
      const r = renderer.domElement.getBoundingClientRect();
      pt.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pt, camera);
      const f = live.current.project.floor;
      const p = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -f.height),
        new THREE.Vector3(),
      );
      if (
        !p ||
        Math.abs(p.x) > f.size / 2 ||
        Math.abs(p.z) > f.size / 2 ||
        !f.confirmed
      )
        return null;
      return p;
    }
    function preview(e: { clientX: number; clientY: number }) {
      const id = live.current.pending;
      if (!id) return;
      const p = floor(e);
      ring.visible = !!p;
      if (p) {
        ring.position.set(p.x, p.y + 0.02, p.z);
        if (ghostId !== id) {
          if (ghost) scene.remove(ghost);
          const source = objects.get(id);
          if (source) {
            ghost = source.clone(true);
            ghost.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.material = (o.material as THREE.Material).clone();
                o.material.transparent = true;
                o.material.opacity = 0.38;
                o.castShadow = false;
              }
            });
            scene.add(ghost);
            ghostId = id;
          }
        }
        if (ghost) {
          ghost.visible = true;
          ghost.position.copy(p);
        }
      } else if (ghost) ghost.visible = false;
      mark();
    }
    function down(e: PointerEvent) {
      if (e.button !== 0) return;
      if (live.current.pending) {
        preview(e);
        return;
      }
      floor(e);
      const hits = ray.intersectObjects(
        [...objects.values()].filter((o) => o.visible),
        true,
      );
      if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !o.userData.itemId) o = o.parent;
        const id = o.userData.itemId;
        if (id) {
          live.current.onSelect(id);
          dragging = id;
          start = objects.get(id)!.position.toArray() as [
            number,
            number,
            number,
          ];
          pointerStart = [e.clientX, e.clientY];
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
      } else live.current.onSelect(null);
      mark();
    }
    function move(e: PointerEvent) {
      if (live.current.pending) {
        preview(e);
        return;
      }
      if (dragging) {
        const p = floor(e);
        if (p) objects.get(dragging)?.position.copy(p);
        mark();
      }
    }
    function up(e: PointerEvent) {
      if (live.current.pending) {
        const p = floor(e);
        if (p)
          live.current.onPlace(
            live.current.pending,
            p.toArray() as [number, number, number],
          );
      }
      if (dragging) {
        const obj = objects.get(dragging)!;
        if (
          Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) >
            3 &&
          floor(e)
        )
          live.current.onMove(
            dragging,
            obj.position.toArray() as [number, number, number],
          );
        else if (start) obj.position.set(...start);
      }
      dragging = null;
      controls.enabled = true;
      mark();
    }
    function cancel() {
      if (dragging && start) objects.get(dragging)?.position.set(...start);
      dragging = null;
      controls.enabled = true;
      mark();
    }
    const dragover = (e: DragEvent) => {
      e.preventDefault();
      preview(e);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("text/plain");
      const p = floor(e);
      if (id && p)
        live.current.onPlace(id, p.toArray() as [number, number, number]);
      ring.visible = false;
      if (ghost) ghost.visible = false;
      mark();
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", cancel);
    renderer.domElement.addEventListener("dragover", dragover);
    renderer.domElement.addEventListener("drop", drop);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      mark();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    function thumb(id: string, g: THREE.Group) {
      const ts = new THREE.Scene();
      ts.background = new THREE.Color("#f3f2ea");
      const clone = g.clone(true);
      clone.visible = true;
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.setScalar(1);
      ts.add(clone);
      ts.add(new THREE.HemisphereLight("#fff", "#8b7967", 3));
      const l = new THREE.DirectionalLight("#fff7e8", 3);
      l.position.set(3, 5, 4);
      ts.add(l);
      const bounds = new THREE.Box3().setFromObject(clone),
        s = bounds.getSize(new THREE.Vector3()),
        c = bounds.getCenter(new THREE.Vector3()),
        d = Math.max(s.x, s.y, s.z);
      const cam = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
      cam.position.copy(c).add(new THREE.Vector3(d * 1.65, d * 0.95, d * 1.85));
      cam.lookAt(c);
      const old = renderer.getSize(new THREE.Vector2());
      renderer.setSize(260, 260, false);
      renderer.setClearColor("#f3f2ea", 1);
      renderer.render(ts, cam);
      live.current.onThumb(id, renderer.domElement.toDataURL("image/png"));
      renderer.setSize(old.x, old.y, false);
      mark();
    }
    engine.current = {
      renderer,
      scene,
      camera,
      controls,
      objects,
      plane,
      grid,
      mark,
      thumb,
      setRoom: (o: THREE.Object3D) => {
        if (room) scene.remove(room);
        room = o;
        scene.add(o);
        mark();
      },
      disposed: () => disposed,
    };
    let last = 0;
    renderer.setAnimationLoop((t) => {
      if (t - last < 30) return;
      last = t;
      controls.update();
      const id = live.current.selected,
        obj = id ? objects.get(id) : null;
      outline.visible = !!obj?.visible;
      if (obj?.visible) outline.box.setFromObject(obj);
      if (!live.current.pending) {
        ring.visible = false;
        if (ghost) ghost.visible = false;
        ghostId = "";
      }
      if (dirty || frames > 0 || live.current.project.room) {
        renderer.render(scene, camera);
        dirty = false;
        frames--;
      }
    });
    return () => {
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      engine.current?.spark?.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      el.replaceChildren();
      engine.current = null;
    };
  }, [props.project.id]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const p = props.project;
    const sig = p.mode === "demo" ? "demo" : p.room?.splat || "empty";
    if (e.roomSig === sig) return;
    e.roomSig = sig;
    if (p.mode === "demo") {
      e.setRoom(demoRoom());
      return;
    }
    if (p.room) {
      import("@sparkjsdev/spark")
        .then(({ SplatMesh, SparkRenderer }) => {
          if (e.disposed()) return;
          if (!e.spark) {
            e.spark = new SparkRenderer({ renderer: e.renderer });
            e.scene.add(e.spark);
          }
          const group = new THREE.Group();
          group.rotation.x = Math.PI;
          const splat = new SplatMesh({ url: asset(p.room!.splat) });
          splat.scale.setScalar(p.room!.scale);
          splat.position.y = -p.room!.offset;
          group.add(splat);
          e.setRoom(group);
          e.camera.position.set(0, 1.3, 3.5);
          e.controls.target.set(0, 1, -1);
          e.controls.update();
          splat.initialized.catch(() =>
            props.onError("空间加载失败，请刷新重试。"),
          );
        })
        .catch(() => props.onError("空间渲染器加载失败。"));
    } else e.setRoom(new THREE.Group());
  }, [props.project.id, props.project.mode, props.project.room?.splat]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const p = props.project;
    e.grid.visible = p.mode !== "demo";
    e.grid.position.y = p.floor.height + 0.005;
    e.grid.scale.setScalar(p.floor.size / 6);
    e.plane.visible = p.mode === "real" && !p.floor.confirmed;
    e.plane.position.y = p.floor.height;
    e.plane.scale.setScalar(p.floor.size);
    for (const [id, o] of e.objects) {
      if (!p.items.some((i) => i.id === id)) {
        e.scene.remove(o);
        e.objects.delete(id);
      }
    }
    for (const item of p.items) {
      let old = e.objects.get(item.id);
      if (old && item.model && !old.userData.model) {
        e.scene.remove(old);
        e.objects.delete(item.id);
        old = null;
      }
      if (!old) {
        const group = new THREE.Group();
        group.userData.itemId = item.id;
        group.userData.model = item.model;
        group.visible = false;
        e.objects.set(item.id, group);
        e.scene.add(group);
        if (p.mode === "demo") {
          group.add(demoModel(item.kind));
          e.thumb(item.id, group);
          e.mark();
        } else if (item.model) {
          new GLTFLoader().load(
            asset(item.model),
            (gltf) => {
              if (e.disposed()) return;
              const model = gltf.scene,
                b = new THREE.Box3().setFromObject(model),
                size = b.getSize(new THREE.Vector3()),
                center = b.getCenter(new THREE.Vector3());
              const k = item.height / Math.max(size.y, 0.001);
              model.scale.setScalar(k);
              model.position.set(-center.x * k, -b.min.y * k, -center.z * k);
              model.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                  o.castShadow = true;
                  o.receiveShadow = true;
                }
              });
              group.add(model);
              e.thumb(item.id, group);
              e.mark();
            },
            undefined,
            () => props.onError(item.name + " 模型加载失败，可刷新重试。"),
          );
        }
      }
      const group = e.objects.get(item.id);
      group.visible = item.status === "placed";
      group.position.set(...item.position);
      group.rotation.y = item.rotation;
      const base = group.userData.height || item.height;
      group.userData.height = base;
      group.scale.setScalar((item.scale * item.height) / base);
    }
    e.mark();
  }, [props.project.items, props.project.floor, props.project.id]);
  useEffect(() => {
    const e = engine.current;
    const id = live.current.selected;
    if (!e || !id) return;
    const obj = e.objects.get(id);
    if (!obj?.visible) return;
    const center = new THREE.Box3()
      .setFromObject(obj)
      .getCenter(new THREE.Vector3());
    const delta = e.camera.position.clone().sub(e.controls.target);
    e.controls.target.copy(center);
    e.camera.position.copy(center).add(delta);
    e.controls.update();
    e.mark();
  }, [props.focus]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.camera.position.set(7.2, 6.1, 8.5);
    e.controls.target.set(0, 0.65, 0);
    e.controls.update();
    e.mark();
  }, [props.reset]);
  return <div className="scene" ref={host} />;
}
