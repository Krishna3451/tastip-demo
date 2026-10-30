"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Destination } from "@tastip/domain";
import {
  Component,
  type ComponentRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { LAND_RINGS } from "./land-data";

type Props = { destination: Destination; routeDestinations?: Destination[] };
type Navigation = { sequence: number; direction: "focus" | "west" | "east" | "north" | "south" };
const NO_ROUTE: Destination[] = [];
const CAMERA_HOME = new THREE.Vector3(0, 0.15, 6.6);
const FOCUS_DIRECTION = new THREE.Vector3(0.12, 0.08, 1).normalize();
function focusRotation(city: Destination) {
  return new THREE.Quaternion().setFromUnitVectors(location(city, 1), FOCUS_DIRECTION);
}
/** Rotate on a great circle, including a stable plane for antipodal endpoints. */
function routePoints(from: Destination, to: Destination) {
  const start = location(from, 1);
  const end = location(to, 1);
  const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  if (angle < 0.00001) return [];
  const axis = start.clone().cross(end);
  if (axis.lengthSq() < 0.00000001)
    axis
      .copy(start)
      .cross(Math.abs(start.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  axis.normalize();
  return Array.from({ length: 65 }, (_, index) =>
    start.clone().applyAxisAngle(axis, (angle * index) / 64),
  );
}
function location(city: Destination, radius = 2.025) {
  const lat = THREE.MathUtils.degToRad(city.lat);
  const lng = THREE.MathUtils.degToRad(city.lng);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lng),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lng),
  );
}
function earthCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#07182f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const land = new Path2D();
  for (const polygon of LAND_RINGS) {
    polygon.forEach(([lng = 0, lat = 0], index) => {
      const x = ((lng + 180) / 360) * canvas.width;
      const y = ((90 - lat) / 180) * canvas.height;
      if (index === 0) land.moveTo(x, y);
      else land.lineTo(x, y);
    });
    land.closePath();
  }
  context.fillStyle = "#174676";
  context.fill(land, "evenodd");
  context.strokeStyle = "#3c89b5";
  context.lineWidth = 1.8;
  context.stroke(land);

  // Seeded grain keeps the surface tactile and deterministic.
  let seed = 47;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  context.save();
  context.clip(land, "evenodd");
  for (let index = 0; index < 750; index++) {
    context.fillStyle = index % 2 === 0 ? "rgba(118,194,238,.07)" : "rgba(2,15,38,.08)";
    context.beginPath();
    context.ellipse(
      random() * 2048,
      random() * 1024,
      8 + random() * 65,
      3 + random() * 18,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.restore();
  for (let index = 0; index < 28000; index++) {
    context.fillStyle = index % 2 === 0 ? "rgba(186,225,255,.09)" : "rgba(2,9,24,.1)";
    const size = 0.4 + random() * 0.9;
    context.fillRect(random() * 2048, random() * 1024, size, size);
  }

  context.strokeStyle = "#5aabcf";
  context.globalAlpha = 0.18;
  context.lineWidth = 1;
  for (let lng = -180; lng <= 180; lng += 15) {
    const x = ((lng + 180) / 360) * 2048;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 1024);
    context.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * 1024;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(2048, y);
    context.stroke();
  }
  context.globalAlpha = 1;
  return canvas;
}
function earthTexture() {
  const canvas = earthCanvas();
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function RouteArc({ from, to, reduced }: { from: Destination; to: Destination; reduced: boolean }) {
  const progress = useRef(0);
  const { invalidate } = useThree();
  const points = useMemo(
    () =>
      routePoints(from, to).map((point, index) =>
        point.multiplyScalar(2.04 + Math.sin((index / 64) * Math.PI) * 0.25),
      ),
    [from, to],
  );
  const geometry = useMemo(
    () =>
      points.length
        ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.009, 6, false)
        : null,
    [points],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => {
    if (!geometry) return;
    progress.current = reduced ? 1 : 0;
    geometry.setDrawRange(0, reduced ? Infinity : 0);
    invalidate();
  }, [geometry, reduced, invalidate]);
  useFrame((_, delta) => {
    if (!geometry || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / 1.3);
    geometry.setDrawRange(0, Math.floor(((geometry.index?.count ?? 0) * progress.current) / 3) * 3);
    invalidate();
  });
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#b9e3f8" transparent opacity={0.9} />
    </mesh>
  );
}
function DestinationMarker({
  city,
  selected,
  reduced,
}: {
  city: Destination;
  selected: boolean;
  reduced: boolean;
}) {
  const halo = useRef<THREE.Mesh>(null);
  const progress = useRef(1);
  const { invalidate } = useThree();
  const orientation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), location(city, 1)),
    [city],
  );
  useEffect(() => {
    progress.current = reduced || !selected ? 1 : 0;
    invalidate();
  }, [selected, reduced, invalidate]);
  useFrame((_, delta) => {
    if (!halo.current || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / 1.15);
    halo.current.scale.setScalar(1 + Math.sin(progress.current * Math.PI) * 0.55);
    invalidate();
  });
  return (
    <group position={location(city, 2.025)} quaternion={orientation}>
      <mesh>
        <sphereGeometry args={[selected ? 0.043 : 0.025, 20, 16]} />
        <meshBasicMaterial color={selected ? "#e5f5ff" : "#8cbfdc"} />
      </mesh>
      {selected && (
        <>
          <mesh position={[0, 0, 0.008]}>
            <ringGeometry args={[0.074, 0.088, 48]} />
            <meshBasicMaterial color="#c9e8ff" side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={halo} position={[0, 0, 0.006]}>
            <ringGeometry args={[0.11, 0.12, 48]} />
            <meshBasicMaterial
              color="#c9e8ff"
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
function Earth({
  destination,
  routeDestinations = NO_ROUTE,
  reduced,
}: Props & { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  const texture = useMemo(earthTexture, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  const rotation = useMemo(() => focusRotation(destination), [destination]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new destination rotation must wake the demand-rendered canvas.
  useEffect(() => {
    invalidate();
  }, [rotation, invalidate]);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.quaternion.slerp(rotation, reduced ? 1 : 1 - Math.exp(-delta * 3.3));
    if (group.current.quaternion.angleTo(rotation) > 0.001) invalidate();
  });
  const pins = [...routeDestinations, destination].filter(
    (city, index, all) => all.findIndex((item) => item.id === city.id) === index,
  );
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[2, 128, 96]} />
        <meshPhysicalMaterial
          map={texture}
          color={texture ? "#ffffff" : "#174676"}
          roughness={0.78}
          metalness={0.13}
          clearcoat={0.14}
          clearcoatRoughness={0.5}
        />
      </mesh>
      <mesh scale={1.018}>
        <sphereGeometry args={[2, 80, 64]} />
        <meshBasicMaterial
          color="#3187db"
          transparent
          opacity={0.05}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {pins.map((city) => (
        <DestinationMarker
          key={city.id}
          city={city}
          selected={city.id === destination.id}
          reduced={reduced}
        />
      ))}
      {routeDestinations.slice(1).map((city, index) => (
        <RouteArc
          reduced={reduced}
          key={`${routeDestinations[index]?.id}-${city.id}`}
          from={routeDestinations[index] ?? destination}
          to={city}
        />
      ))}
    </group>
  );
}
function GlobeNavigation({
  destination,
  navigation,
  reduced,
  onExplore,
}: Props & { navigation: Navigation; reduced: boolean; onExplore: () => void }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera, invalidate } = useThree();
  const target = useRef(CAMERA_HOME.clone());
  const moving = useRef(false);
  const lastDestination = useRef("");
  const destinationKey = `${destination.id}:${destination.lat}:${destination.lng}`;
  useEffect(() => {
    const changed = lastDestination.current !== destinationKey;
    lastDestination.current = destinationKey;
    if (changed || navigation.direction === "focus") target.current.copy(CAMERA_HOME);
    else {
      const spherical = new THREE.Spherical().setFromVector3(camera.position);
      if (navigation.direction === "west") spherical.theta -= Math.PI / 8;
      if (navigation.direction === "east") spherical.theta += Math.PI / 8;
      if (navigation.direction === "north") spherical.phi -= Math.PI / 10;
      if (navigation.direction === "south") spherical.phi += Math.PI / 10;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.3, Math.PI - 0.3);
      target.current.setFromSpherical(spherical);
    }
    moving.current = true;
    invalidate();
  }, [destinationKey, navigation, camera, invalidate]);
  useFrame((_, delta) => {
    if (!moving.current) return;
    camera.position.lerp(target.current, reduced ? 1 : 1 - Math.exp(-delta * 7));
    if (camera.position.distanceToSquared(target.current) < 0.000001) {
      camera.position.copy(target.current);
      moving.current = false;
    }
    controls.current?.update();
    invalidate();
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableZoom={false}
      enableDamping={!reduced}
      dampingFactor={0.12}
      rotateSpeed={0.4}
      minPolarAngle={0.3}
      maxPolarAngle={Math.PI - 0.3}
      onStart={() => {
        moving.current = false;
        onExplore();
      }}
    />
  );
}
function GeographicFallback({ destination, routeDestinations = NO_ROUTE }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    const texture = earthCanvas();
    const source = texture?.getContext("2d");
    if (!canvas || !context || !texture || !source) return;
    const pixels = source.getImageData(0, 0, texture.width, texture.height).data;
    const size = canvas.width;
    const radius = size * 0.46;
    const center = size / 2;
    const image = context.createImageData(size, size);
    const rotation = focusRotation(destination);
    const inverse = rotation.clone().invert();
    const point = new THREE.Vector3();
    const light = new THREE.Vector3(-0.4, 0.6, 1).normalize();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x - center) / radius;
        const ny = (center - y) / radius;
        const distance = nx * nx + ny * ny;
        if (distance > 1) continue;
        point.set(nx, ny, Math.sqrt(1 - distance));
        const shade = 0.42 + Math.max(0, point.dot(light)) * 0.58;
        point.applyQuaternion(inverse);
        const tx = Math.min(
          texture.width - 1,
          Math.max(
            0,
            Math.floor(((Math.atan2(-point.z, point.x) + Math.PI) / (2 * Math.PI)) * texture.width),
          ),
        );
        const ty = Math.min(
          texture.height - 1,
          Math.max(
            0,
            Math.floor(
              ((Math.PI / 2 - Math.asin(THREE.MathUtils.clamp(point.y, -1, 1))) / Math.PI) *
                texture.height,
            ),
          ),
        );
        const offset = (y * size + x) * 4;
        const sample = (ty * texture.width + tx) * 4;
        image.data[offset] = pixels[sample]! * shade;
        image.data[offset + 1] = pixels[sample + 1]! * shade;
        image.data[offset + 2] = pixels[sample + 2]! * shade;
        image.data[offset + 3] = Math.min(255, (1 - distance) * radius * 255);
      }
    }
    context.putImageData(image, 0, 0);
    context.strokeStyle = "#b9e3f8";
    context.lineWidth = 1.8;
    for (const [index, to] of routeDestinations.entries()) {
      const from = routeDestinations[index - 1];
      if (!from) continue;
      context.beginPath();
      let connected = false;
      for (const point of routePoints(from, to)) {
        point.applyQuaternion(rotation);
        if (point.z < 0) {
          connected = false;
          continue;
        }
        const x = center + point.x * radius;
        const y = center - point.y * radius;
        if (connected) context.lineTo(x, y);
        else context.moveTo(x, y);
        connected = true;
      }
      context.stroke();
    }
    for (const city of [...routeDestinations, destination]) {
      const point = location(city, 1).applyQuaternion(rotation);
      if (point.z < 0) continue;
      const selected = city.id === destination.id;
      const x = center + point.x * radius;
      const y = center - point.y * radius;
      context.fillStyle = selected ? "#e5f5ff" : "#8cbfdc";
      context.beginPath();
      context.arc(x, y, selected ? 3.5 : 2.5, 0, Math.PI * 2);
      context.fill();
      if (selected) {
        context.beginPath();
        context.arc(x, y, 8, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }, [destination, routeDestinations]);
  return (
    <div className="earth-fallback geographic-fallback">
      <canvas ref={ref} width={448} height={448} />
      <small>Map view · Your destination and trip controls work without 3D.</small>
    </div>
  );
}
function OrbitDust() {
  const geometry = useMemo(() => {
    const vertices = Array.from({ length: 220 }, (_, i) => {
      const a = i * 2.39996;
      const r = 4 + (i % 11) * 0.14;
      return [Math.cos(a) * r, Math.sin(a * 1.7) * r, -3 - (i % 7) * 0.4];
    }).flat();
    const value = new THREE.BufferGeometry();
    value.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return value;
  }, []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#75aad0" size={0.012} transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}
class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function Globe({ destination, routeDestinations }: Props) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [lost, setLost] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [navigation, setNavigation] = useState<Navigation>({ sequence: 0, direction: "focus" });
  const helpId = useId();
  const onExplore = useCallback(() => setExploring(true), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A destination change resets manual globe exploration.
  useEffect(() => setExploring(false), [destination.id, destination.lat, destination.lng]);
  function navigate(direction: Navigation["direction"]) {
    setExploring(direction !== "focus");
    setNavigation((current) => ({ sequence: current.sequence + 1, direction }));
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = {
      ArrowLeft: "west",
      ArrowRight: "east",
      ArrowUp: "north",
      ArrowDown: "south",
      Home: "focus",
    }[event.key] as Navigation["direction"] | undefined;
    if (!direction) return;
    event.preventDefault();
    navigate(direction);
  }
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
      setReady(Boolean(context));
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setReady(false);
    }
    return () => media.removeEventListener("change", update);
  }, []);
  const fallback = (
    <GeographicFallback destination={destination} routeDestinations={routeDestinations} />
  );
  const routeLabel = routeDestinations?.length
    ? ` Route intent: ${routeDestinations.map((city) => city.name).join(" to ")}.`
    : "";
  return (
    <div className="premium-globe">
      <div
        className="globe-surface"
        role="img"
        aria-label={`${ready && !lost ? "Interactive globe" : "Geographic globe"} focused on ${destination.name}.${routeLabel}`}
      >
        {ready && !lost ? (
          <Boundary fallback={fallback} onFailure={() => setLost(true)}>
            <Canvas
              frameloop="demand"
              dpr={[1, 1.75]}
              camera={{ position: [0, 0.15, 6.6], fov: 39, near: 0.1, far: 40 }}
              gl={{ alpha: true, antialias: true }}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener("webglcontextlost", () => setLost(true), {
                  once: true,
                });
              }}
            >
              <ambientLight color="#3b74a7" intensity={0.8} />
              <hemisphereLight args={["#93b7de", "#07182f", 1.2]} />
              <directionalLight position={[-3, 4, 5]} color="#96c9ff" intensity={3.1} />
              <directionalLight position={[4, -1, -2]} color="#2b75d1" intensity={2.0} />
              <OrbitDust />
              <Earth
                destination={destination}
                routeDestinations={routeDestinations}
                reduced={reduced}
              />
              <GlobeNavigation
                destination={destination}
                navigation={navigation}
                reduced={reduced}
                onExplore={onExplore}
              />
            </Canvas>
          </Boundary>
        ) : ready === null ? (
          <div className="globe-loading" role="status">
            Opening your world…
          </div>
        ) : (
          fallback
        )}
      </div>
      {ready && !lost && (
        <div className="globe-controls">
          <span id={helpId} className="globe-control-help">
            Use arrow keys to rotate the globe, or Home to focus your selected destination.
          </span>
          <button
            type="button"
            aria-label="Rotate globe west"
            aria-describedby={helpId}
            onKeyDown={keyboard}
            onClick={() => navigate("west")}
          >
            ←
          </button>
          <button
            type="button"
            className="globe-refocus"
            aria-label={`Focus globe on ${destination.name}`}
            aria-describedby={helpId}
            onKeyDown={keyboard}
            onClick={() => navigate("focus")}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="5" />
              <path d="M10 1v4m0 10v4M1 10h4m10 0h4" />
            </svg>
            {exploring ? "Refocus" : "Focus"}
          </button>
          <button
            type="button"
            aria-label="Rotate globe east"
            aria-describedby={helpId}
            onKeyDown={keyboard}
            onClick={() => navigate("east")}
          >
            →
          </button>
        </div>
      )}
      <p className="globe-control-help" aria-live="polite">
        {exploring
          ? "Exploring the globe. Your destination is unchanged."
          : `${destination.name}, ${destination.country} selected.`}
      </p>
    </div>
  );
}
