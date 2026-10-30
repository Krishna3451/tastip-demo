"use client";

import { Html, useCursor } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import type { Trip } from "@tastip/domain";
import {
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { createIslandTerrain } from "./terrain-geometry";

export type JourneySceneNode = {
  id: string;
  name: string;
  category: "cafe" | "culture" | "food" | "outdoors" | "shop";
  time: string;
  duration: number;
  pinned: boolean;
  timeLocked: boolean;
  landmark?: "eiffel-tower" | "belem-tower" | "torii-gate" | "round-tower";
  day?: { label: string; city: string; visits: number; number: number };
};
type Point = [number, number, number];
type SceneProps = {
  nodes: JourneySceneNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  dayKey?: string;
  focused?: boolean;
  fallback: ReactNode;
};

// Original miniature geometry. These are category illustrations, not venue models.
const colors = {
  cream: "#c9d3cb",
  wall: "#a4ada2",
  stone: "#6b777a",
  earth: "#685b47",
  earthDark: "#3a3936",
  grass: "#466d48",
  grassLight: "#608157",
  forest: "#244b3c",
  leaf: "#3f7151",
  leafLight: "#6d925c",
  wood: "#68523c",
  clay: "#8f5547",
  clayLight: "#b7845b",
  water: "#225c70",
  window: "#edbd78",
  path: "#969a82",
};
type TerrainTextures = {
  grass: THREE.CanvasTexture;
  rock: THREE.CanvasTexture;
  height: THREE.CanvasTexture;
};

function terrainTextures(): TerrainTextures {
  const make = (base: [number, number, number], bump = false) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const pixels = context.createImageData(256, 256);
      let seed = 71;
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          seed = (seed * 16807) % 2147483647;
          const grain = ((seed - 1) / 2147483646 - 0.5) * (bump ? 18 : 10);
          const folds =
            Math.sin(x * 0.12 + Math.sin(y * 0.07) * 2) *
            Math.cos(y * 0.1 + Math.sin(x * 0.06)) *
            (bump ? 15 : 8);
          const fine = Math.sin(x * 0.41 + y * 0.32) * (bump ? 4 : 2);
          const offset = (y * 256 + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            pixels.data[offset + channel] = (base[channel] ?? 0) + grain + folds + fine;
          pixels.data[offset + 3] = 255;
        }
      context.putImageData(pixels, 0, 0);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.65, 0.65);
    if (!bump) texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };
  return {
    grass: make([72, 104, 60]),
    rock: make([96, 101, 100]),
    height: make([127, 127, 127], true),
  };
}
const viewDirection = new THREE.Vector3(7, 10, 12).normalize();
const screenRight = new THREE.Vector3(viewDirection.z, 0, -viewDirection.x).normalize();
const screenBack = new THREE.Vector3(-viewDirection.x, 0, -viewDirection.z).normalize();
const screenUp = new THREE.Vector3().crossVectors(viewDirection, screenRight).normalize();
const origin: Point = [0, 0, 0];

function groundPoint(across: number, back: number, height = 0): Point {
  return [
    screenRight.x * across + screenBack.x * back,
    height,
    screenRight.z * across + screenBack.z * back,
  ];
}

function layout(count: number, aspect: number): Point[] {
  if (count === 1) return [origin];
  const stagger = aspect < 0.8 ? 0.8 : 1.5;
  return Array.from({ length: count }, (_, index) =>
    groundPoint(index % 2 ? stagger : -stagger, (index - (count - 1) / 2) * 6.5),
  );
}

function Block({
  at = origin,
  size,
  color,
  rotation,
}: {
  at?: Point;
  size: Point;
  color: string;
  rotation?: Point;
}) {
  return (
    <mesh position={at} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={color === colors.window ? 0.4 : 0.92}
        emissive={color === colors.window ? colors.window : undefined}
        emissiveIntensity={color === colors.window ? 1.1 : 0}
      />
    </mesh>
  );
}

function Cylinder({
  at,
  radius,
  height,
  color,
  top = radius,
}: {
  at: Point;
  radius: number;
  height: number;
  color: string;
  top?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <cylinderGeometry args={[top, radius, height, 20]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function Pebble({
  at,
  scale = [1, 1, 1],
  color = colors.stone,
  texture,
}: {
  at: Point;
  scale?: Point;
  color?: string;
  texture?: THREE.Texture;
}) {
  return (
    <mesh position={at} scale={scale} rotation={[0.12, at[0] * 2, 0.2]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.14, 0]} />
      <meshStandardMaterial
        color={color}
        map={texture}
        bumpMap={texture}
        bumpScale={0.045}
        roughness={1}
        flatShading
      />
    </mesh>
  );
}

function Tree({
  at,
  scale = 1,
  slender = false,
}: {
  at: Point;
  scale?: number;
  slender?: boolean;
}) {
  return (
    <group position={at} scale={scale}>
      <Cylinder at={[0, 0.36, 0]} radius={0.045} top={0.028} height={0.72} color={colors.wood} />
      {slender ? (
        <>
          <mesh position={[0, 0.87, 0]} scale={[0.68, 1.5, 0.68]} castShadow>
            <icosahedronGeometry args={[0.38, 1]} />
            <meshStandardMaterial color={colors.forest} roughness={1} flatShading />
          </mesh>
          <mesh position={[0.04, 1.22, 0]} scale={[0.6, 1.3, 0.6]} castShadow>
            <icosahedronGeometry args={[0.25, 1]} />
            <meshStandardMaterial color={colors.leaf} roughness={1} flatShading />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[-0.13, 0.86, 0]} scale={[1, 1.08, 0.95]} castShadow>
            <icosahedronGeometry args={[0.38, 2]} />
            <meshStandardMaterial color={colors.leaf} roughness={1} flatShading />
          </mesh>
          <mesh position={[0.2, 0.91, 0.04]} castShadow>
            <icosahedronGeometry args={[0.3, 2]} />
            <meshStandardMaterial color={colors.forest} roughness={1} flatShading />
          </mesh>
          <mesh position={[0, 1.12, -0.05]} castShadow>
            <icosahedronGeometry args={[0.29, 2]} />
            <meshStandardMaterial color={colors.leafLight} roughness={1} flatShading />
          </mesh>
        </>
      )}
    </group>
  );
}

function Bench({ at, rotation = 0 }: { at: Point; rotation?: number }) {
  return (
    <group position={at} rotation={[0, rotation, 0]}>
      <Block size={[0.56, 0.065, 0.23]} at={[0, 0.24, 0]} color={colors.wood} />
      <Block size={[0.56, 0.21, 0.045]} at={[0, 0.39, -0.105]} color={colors.clayLight} />
      {[-0.2, 0.2].map((x) => (
        <Block key={x} size={[0.04, 0.24, 0.17]} at={[x, 0.12, 0]} color={colors.forest} />
      ))}
    </group>
  );
}

function Table({ at, scale = 1, plates = false }: { at: Point; scale?: number; plates?: boolean }) {
  return (
    <group position={at} scale={scale}>
      <Cylinder at={[0, 0.22, 0]} radius={0.025} height={0.44} color={colors.forest} />
      <Cylinder at={[0, 0.44, 0]} radius={0.24} height={0.05} color={colors.cream} />
      <Cylinder
        at={[0.07, 0.475, 0]}
        radius={plates ? 0.085 : 0.055}
        height={0.014}
        color={colors.wall}
      />
      <Cylinder at={[0.07, 0.515, 0]} radius={0.036} height={0.07} color={colors.clay} />
      <Cylinder at={[0.07, 0.551, 0]} radius={0.025} height={0.003} color={colors.wood} />
      {[-0.34, 0.34].map((x) => (
        <group key={x}>
          <Cylinder at={[x, 0.13, 0]} radius={0.028} height={0.26} color={colors.forest} />
          <Cylinder at={[x, 0.27, 0]} radius={0.105} height={0.055} color={colors.wood} />
        </group>
      ))}
    </group>
  );
}

function Roof({
  at,
  width = 1.22,
  depth = 1.04,
  color = colors.clay,
}: {
  at: Point;
  width?: number;
  depth?: number;
  color?: string;
}) {
  const shape = useMemo(() => {
    const result = new THREE.Shape();
    result.moveTo(-width / 2, 0);
    result.lineTo(0, 0.35);
    result.lineTo(width / 2, 0);
    result.closePath();
    return result;
  }, [width]);
  return (
    <group position={at}>
      <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
        <extrudeGeometry args={[shape, { depth, bevelEnabled: false }]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      <Block at={[0, 0.35, 0]} size={[0.045, 0.045, depth + 0.035]} color={colors.clayLight} />
    </group>
  );
}

function Awning({ color = colors.clay }: { color?: string }) {
  return (
    <group position={[0, 0.63, 0.55]}>
      {Array.from({ length: 8 }, (_, index) => ({ x: (index - 3.5) * 0.13, index })).map(
        ({ x, index }) => (
          <group key={x} position={[x, 0, 0]}>
            <Block
              size={[0.13, 0.035, 0.4]}
              rotation={[0.23, 0, 0]}
              color={index % 2 ? colors.cream : color}
            />
            <Block
              at={[0, -0.095, 0.19]}
              size={[0.13, 0.11, 0.025]}
              color={index % 2 ? colors.cream : color}
            />
          </group>
        ),
      )}
    </group>
  );
}

function Cottage({ shop = false }: { shop?: boolean }) {
  return (
    <group position={[-0.26, 0.06, -0.3]} rotation={[0, -0.18, 0]}>
      <Block at={[0, 0.04, 0]} size={[1.13, 0.08, 0.94]} color={colors.stone} />
      <Block at={[0, 0.38, 0]} size={[1, 0.65, 0.8]} color={colors.wall} />
      <Roof at={[0, 0.72, 0]} color={shop ? colors.forest : colors.clay} />
      <Block at={[-0.27, 0.3, 0.411]} size={[0.23, 0.49, 0.025]} color={colors.forest} />
      <Block at={[-0.27, 0.37, 0.428]} size={[0.15, 0.24, 0.012]} color={colors.water} />
      <Block at={[0.23, 0.38, 0.415]} size={[0.34, 0.31, 0.025]} color={colors.window} />
      <Block at={[0.23, 0.38, 0.435]} size={[0.026, 0.31, 0.014]} color={colors.cream} />
      <Block at={[0.23, 0.38, 0.435]} size={[0.34, 0.025, 0.014]} color={colors.cream} />
      <Block at={[0.512, 0.4, -0.03]} size={[0.025, 0.28, 0.34]} color={colors.window} />
      <Awning color={shop ? colors.forest : colors.clay} />
      <Block at={[0.36, 0.92, -0.19]} size={[0.14, 0.43, 0.17]} color={colors.clayLight} />
    </group>
  );
}

function Cafe() {
  return (
    <>
      <Block
        at={[0.45, 0.025, 0.64]}
        size={[1.17, 0.055, 0.65]}
        color={colors.path}
        rotation={[0, -0.18, 0]}
      />
      <Cottage />
      <Table at={[0.53, 0.065, 0.6]} scale={0.86} />
      <Tree at={[-1.03, 0.05, -0.52]} scale={0.88} />
      <Tree at={[1.03, 0.04, -0.19]} scale={0.64} />
      <Block
        at={[-0.86, 0.26, 0.56]}
        size={[0.25, 0.36, 0.055]}
        color={colors.forest}
        rotation={[-0.16, -0.1, 0]}
      />
      <Block at={[-0.86, 0.31, 0.6]} size={[0.15, 0.018, 0.012]} color={colors.cream} />
      <Block at={[-0.86, 0.25, 0.61]} size={[0.1, 0.016, 0.012]} color={colors.cream} />
    </>
  );
}

function Gallery() {
  return (
    <>
      <group position={[-0.22, 0.04, -0.3]} rotation={[0, -0.14, 0]}>
        <Block at={[0, 0.04, 0]} size={[1.45, 0.08, 1.07]} color={colors.stone} />
        <Block at={[0, 0.12, -0.05]} size={[1.3, 0.08, 0.91]} color={colors.wall} />
        <Block at={[0, 0.54, -0.2]} size={[1.22, 0.77, 0.52]} color={colors.cream} />
        <Block at={[0, 0.44, 0.068]} size={[0.31, 0.55, 0.022]} color={colors.window} />
        {[-0.49, -0.17, 0.17, 0.49].map((x) => (
          <group key={x}>
            <Cylinder
              at={[x, 0.53, 0.36]}
              radius={0.062}
              top={0.055}
              height={0.73}
              color={colors.cream}
            />
            <Block at={[x, 0.18, 0.36]} size={[0.16, 0.065, 0.16]} color={colors.wall} />
            <Block at={[x, 0.89, 0.36]} size={[0.17, 0.065, 0.17]} color={colors.wall} />
          </group>
        ))}
        <Roof at={[0, 0.94, 0]} width={1.48} depth={1.04} color={colors.forest} />
      </group>
      <Tree at={[-1.06, 0.04, -0.46]} scale={0.8} slender />
      <Tree at={[0.83, 0.04, -0.77]} scale={0.69} slender />
      <group position={[0.8, 0.06, 0.56]}>
        <Block at={[0, 0.14, 0]} size={[0.3, 0.28, 0.3]} color={colors.cream} />
        <mesh position={[0, 0.52, 0]} rotation={[0.12, -0.2, -0.32]} castShadow>
          <torusGeometry args={[0.19, 0.05, 10, 32]} />
          <meshStandardMaterial color={colors.clay} roughness={0.6} />
        </mesh>
        <mesh position={[0.025, 0.54, 0.02]} castShadow>
          <sphereGeometry args={[0.067, 16, 12]} />
          <meshStandardMaterial color={colors.clayLight} roughness={0.6} />
        </mesh>
      </group>
    </>
  );
}

function Parasol({ at }: { at: Point }) {
  const canopy = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const shades: number[] = [];
    for (let index = 0; index < 8; index++) {
      const a = (index / 8) * Math.PI * 2;
      const b = ((index + 1) / 8) * Math.PI * 2;
      positions.push(
        0,
        0.27,
        0,
        Math.cos(a) * 0.53,
        0,
        Math.sin(a) * 0.53,
        Math.cos(b) * 0.53,
        0,
        Math.sin(b) * 0.53,
      );
      const shade = new THREE.Color(index % 2 ? colors.cream : colors.clayLight);
      shades.push(...shade.toArray(), ...shade.toArray(), ...shade.toArray());
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(shades, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);
  useEffect(() => () => canopy.dispose(), [canopy]);
  return (
    <group position={at}>
      <Cylinder at={[0, 0.54, 0]} radius={0.023} height={1.08} color={colors.wood} />
      <mesh geometry={canopy} position={[0, 1.03, 0]} castShadow>
        <meshStandardMaterial vertexColors roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <Cylinder at={[0, 1.31, 0]} radius={0.027} height={0.06} color={colors.wood} />
    </group>
  );
}

function Food() {
  return (
    <>
      <group position={[-0.63, 0.04, -0.47]} rotation={[0, -0.15, 0]}>
        <Block at={[0, 0.25, 0]} size={[0.73, 0.5, 0.58]} color={colors.wall} />
        <Block at={[0, 0.47, 0.27]} size={[0.83, 0.07, 0.31]} color={colors.wood} />
        <Block at={[0, 0.7, -0.2]} size={[0.72, 0.36, 0.08]} color={colors.cream} />
        <Roof at={[0, 0.9, -0.05]} width={0.99} depth={0.85} />
        {[-0.3, 0.3].map((x) => (
          <Block key={x} at={[x, 0.68, 0.26]} size={[0.035, 0.4, 0.035]} color={colors.wood} />
        ))}
        <Block at={[0, 0.57, 0.27]} size={[0.29, 0.09, 0.2]} color={colors.clayLight} />
        {[-0.08, 0, 0.08].map((x) => (
          <Pebble key={x} at={[x, 0.64, 0.27]} scale={[0.24, 0.25, 0.24]} color={colors.clay} />
        ))}
      </group>
      <Table at={[0.53, 0.06, 0.43]} scale={1.04} plates />
      <Parasol at={[0.58, 0.05, 0.45]} />
      <Tree at={[0.65, 0.04, -0.84]} scale={0.82} />
      <Tree at={[-1.09, 0.04, 0.33]} scale={0.63} />
      <Pebble at={[1.1, 0.06, 0.55]} scale={[0.7, 0.45, 0.9]} />
    </>
  );
}

function Garden() {
  const pond = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.85, -0.16);
    shape.bezierCurveTo(-1, -0.62, -0.36, -0.8, 0.08, -0.55);
    shape.bezierCurveTo(0.4, -0.36, 0.94, -0.37, 0.9, 0.08);
    shape.bezierCurveTo(0.86, 0.59, 0.38, 0.58, 0.04, 0.49);
    shape.bezierCurveTo(-0.4, 0.62, -0.68, 0.34, -0.85, -0.16);
    return shape;
  }, []);
  const rails = useMemo(
    () =>
      [-0.23, 0.23].map(
        (z) =>
          new THREE.CatmullRomCurve3(
            Array.from({ length: 9 }, (_, index) => {
              const x = (index - 4) * 0.14;
              return new THREE.Vector3(x, 0.38 + 0.13 * (1 - (x / 0.65) ** 2), z);
            }),
          ),
      ),
    [],
  );
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0.03]} receiveShadow>
        <shapeGeometry args={[pond, 40]} />
        <meshStandardMaterial color={colors.water} roughness={0.3} metalness={0.08} />
      </mesh>
      <group position={[0.03, 0, 0.12]} rotation={[0, -0.23, 0]}>
        {Array.from({ length: 9 }, (_, index) => {
          const x = (index - 4) * 0.14;
          return (
            <Block
              key={x}
              at={[x, 0.15 + 0.13 * (1 - (x / 0.65) ** 2), 0]}
              size={[0.13, 0.045, 0.47]}
              color={colors.wood}
            />
          );
        })}
        {rails.map((curve) => (
          <mesh key={JSON.stringify(curve.points)} castShadow>
            <tubeGeometry args={[curve, 28, 0.018, 6, false]} />
            <meshStandardMaterial color={colors.wood} roughness={0.9} />
          </mesh>
        ))}
        {[-0.52, 0.52].flatMap((x) =>
          [-0.23, 0.23].map((z) => (
            <Cylinder
              key={`${x}:${z}`}
              at={[x, 0.29, z]}
              radius={0.017}
              height={0.32}
              color={colors.wood}
            />
          )),
        )}
      </group>
      <Tree at={[-0.91, 0.04, -0.53]} scale={1.04} />
      <Tree at={[0.67, 0.04, -0.76]} scale={0.96} />
      <Tree at={[1.04, 0.04, 0.29]} scale={0.66} />
      <Bench at={[-0.66, 0.04, 0.8]} rotation={-0.3} />
      <Pebble at={[-0.95, 0.08, -0.03]} scale={[1.2, 0.7, 0.8]} />
      <Pebble at={[0.88, 0.08, 0.42]} scale={[0.8, 0.6, 1.1]} />
      <mesh position={[0.48, 0.062, -0.18]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 24]} />
        <meshStandardMaterial color={colors.leaf} roughness={0.8} />
      </mesh>
      <Pebble at={[0.5, 0.085, -0.17]} scale={[0.2, 0.13, 0.2]} color={colors.cream} />
    </>
  );
}

function Bookshop() {
  const spines = [
    colors.clay,
    colors.cream,
    colors.forest,
    colors.clayLight,
    colors.window,
    colors.path,
  ];
  return (
    <>
      <Cottage shop />
      <group position={[0.67, 0.07, 0.56]} rotation={[0, -0.24, 0]}>
        <Block at={[0, 0.17, 0]} size={[0.51, 0.34, 0.32]} color={colors.wood} />
        <Block at={[0, 0.35, 0]} size={[0.57, 0.055, 0.38]} color={colors.wall} />
        {spines.map((color, index) => (
          <Block
            key={color}
            at={[(index - 2.5) * 0.071, 0.46 + (index % 3) * 0.018, 0]}
            size={[0.061, 0.19 + (index % 3) * 0.035, 0.19]}
            color={color}
            rotation={[0, 0, index === 5 ? -0.16 : 0]}
          />
        ))}
      </group>
      <group position={[-0.86, 0.04, 0.59]} rotation={[0, -0.18, 0]}>
        <Cylinder at={[0, 0.36, 0]} radius={0.024} height={0.72} color={colors.wood} />
        <Block at={[0.12, 0.65, 0]} size={[0.31, 0.24, 0.045]} color={colors.cream} />
        <Block at={[0.08, 0.65, 0.03]} size={[0.025, 0.12, 0.018]} color={colors.clay} />
        <Block at={[0.14, 0.65, 0.03]} size={[0.025, 0.12, 0.018]} color={colors.forest} />
        <Block at={[0.2, 0.65, 0.03]} size={[0.025, 0.12, 0.018]} color={colors.wood} />
      </group>
      <Tree at={[-0.98, 0.04, -0.6]} scale={0.82} />
      <Tree at={[0.97, 0.04, -0.44]} scale={0.72} />
    </>
  );
}

type BeamSegment = { from: Point; to: Point; width: number };

function Lattice({ segments }: { segments: BeamSegment[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const beam = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    segments.forEach(({ from, to, width }, index) => {
      const a = new THREE.Vector3(...from),
        b = new THREE.Vector3(...to);
      beam.position.copy(a).add(b).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      beam.scale.set(width, a.distanceTo(b), width);
      beam.updateMatrix();
      mesh.current?.setMatrixAt(index, beam.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [segments, invalidate]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, segments.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#887b62" metalness={0.7} roughness={0.48} />
    </instancedMesh>
  );
}

function EiffelTower() {
  const { segments, arches } = useMemo(() => {
    const segments: BeamSegment[] = [];
    const levels: [number, number][] = [
      [0.03, 0.57],
      [0.73, 0.34],
      [1.2, 0.23],
      [1.73, 0.13],
      [2.38, 0.035],
    ];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (let i = 0; i < levels.length - 1; i++) {
          const a = levels[i],
            b = levels[i + 1];
          if (a && b)
            segments.push({
              from: [sx * a[1], a[0], sz * a[1]],
              to: [sx * b[1], b[0], sz * b[1]],
              width: i === 0 ? 0.065 : 0.037,
            });
        }
    const rotate = (x: number, y: number, z: number, face: number): Point => {
      const angle = (face * Math.PI) / 2;
      return [
        x * Math.cos(angle) - z * Math.sin(angle),
        y,
        x * Math.sin(angle) + z * Math.cos(angle),
      ];
    };
    for (let i = 1; i < levels.length - 1; i++) {
      const lower = levels[i],
        upper = levels[i + 1];
      if (!lower || !upper) continue;
      for (let section = 0; section < 3; section++) {
        const t = section / 3,
          u = (section + 1) / 3;
        const y0 = THREE.MathUtils.lerp(lower[0], upper[0], t),
          y1 = THREE.MathUtils.lerp(lower[0], upper[0], u);
        const w0 = THREE.MathUtils.lerp(lower[1], upper[1], t),
          w1 = THREE.MathUtils.lerp(lower[1], upper[1], u);
        for (let face = 0; face < 4; face++) {
          segments.push({
            from: rotate(-w0, y0, w0, face),
            to: rotate(w1, y1, w1, face),
            width: 0.018,
          });
          segments.push({
            from: rotate(w0, y0, w0, face),
            to: rotate(-w1, y1, w1, face),
            width: 0.018,
          });
          segments.push({
            from: rotate(-w1, y1, w1, face),
            to: rotate(w1, y1, w1, face),
            width: 0.022,
          });
        }
      }
    }
    const arches = [0, 1, 2, 3].map(
      (face) =>
        new THREE.CatmullRomCurve3(
          [
            [-0.57, 0.03, 0.57],
            [-0.39, 0.42, 0.43],
            [0, 0.63, 0.34],
            [0.39, 0.42, 0.43],
            [0.57, 0.03, 0.57],
          ].map(([x = 0, y = 0, z = 0]) => new THREE.Vector3(...rotate(x, y, z, face))),
        ),
    );
    segments.push({ from: [0, 2.38, 0], to: [0, 2.76, 0], width: 0.025 });
    return { segments, arches };
  }, []);
  return (
    <group position={[0, 0.06, -0.12]}>
      <Cylinder at={[0, 0.015, 0]} radius={0.94} height={0.03} color={colors.path} />
      <Lattice segments={segments} />
      {arches.map((curve) => (
        <mesh key={JSON.stringify(curve.points)} castShadow>
          <tubeGeometry args={[curve, 32, 0.035, 8, false]} />
          <meshStandardMaterial color="#8c7d64" metalness={0.65} roughness={0.48} />
        </mesh>
      ))}
      <Block at={[0, 0.73, 0]} size={[0.81, 0.055, 0.81]} color={colors.wood} />
      <Block at={[0, 1.2, 0]} size={[0.57, 0.055, 0.57]} color={colors.wood} />
      <Block at={[0, 2.31, 0]} size={[0.22, 0.045, 0.22]} color={colors.window} />
      <Tree at={[-1.05, 0.02, -0.36]} scale={0.7} />
      <Tree at={[0.99, 0.02, -0.57]} scale={0.64} />
      <pointLight position={[0, 0.9, 0.5]} color="#ffbb71" intensity={0.8} distance={3} decay={2} />
    </group>
  );
}

function BelemTower() {
  return (
    <group position={[0, 0.07, -0.05]} rotation={[0, -0.18, 0]}>
      <mesh position={[0, 0.13, 0.2]} rotation={[0, Math.PI / 6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.92, 0.98, 0.26, 6]} />
        <meshStandardMaterial color={colors.wall} roughness={0.95} />
      </mesh>
      <Block at={[0, 0.39, -0.05]} size={[1.5, 0.26, 1.14]} color={colors.cream} />
      <Block at={[0, 1.14, -0.3]} size={[0.76, 1.48, 0.73]} color={colors.wall} />
      {[0.48, 0.94, 1.4, 1.86].map((y) => (
        <Block key={y} at={[0, y, -0.3]} size={[0.84, 0.065, 0.81]} color={colors.cream} />
      ))}
      {[0.7, 1.14, 1.58].flatMap((y) =>
        [-0.17, 0.17].map((x) => (
          <Block
            key={`${x}:${y}`}
            at={[x, y, 0.075]}
            size={[0.105, 0.2, 0.026]}
            color={colors.window}
          />
        )),
      )}
      {[0.7, 1.14, 1.58].flatMap((y) =>
        [-0.47, -0.14].map((z) => (
          <Block
            key={`${z}:${y}`}
            at={[0.387, y, z]}
            size={[0.026, 0.18, 0.1]}
            color={colors.window}
          />
        )),
      )}
      <Block at={[0, 1.06, 0.17]} size={[0.62, 0.055, 0.22]} color={colors.cream} />
      {[-0.27, 0, 0.27].map((x) => (
        <Block key={x} at={[x, 1.16, 0.27]} size={[0.035, 0.17, 0.035]} color={colors.cream} />
      ))}
      {[-0.38, 0.38].flatMap((x) =>
        [-0.68, 0.08].map((z) => (
          <group key={`${x}:${z}`} position={[x, 1.99, z]}>
            <Cylinder at={[0, 0, 0]} radius={0.095} height={0.28} color={colors.cream} />
            <mesh position={[0, 0.21, 0]} castShadow>
              <coneGeometry args={[0.135, 0.19, 12]} />
              <meshStandardMaterial color={colors.wall} roughness={0.9} />
            </mesh>
          </group>
        )),
      )}
      {[-0.66, 0.66].flatMap((x) =>
        [-0.5, 0.48].map((z) => (
          <group key={`${x}:${z}`} position={[x, 0.6, z]}>
            <Cylinder at={[0, 0, 0]} radius={0.12} height={0.31} color={colors.wall} />
            <mesh position={[0, 0.24, 0]} castShadow>
              <coneGeometry args={[0.16, 0.2, 12]} />
              <meshStandardMaterial color={colors.cream} roughness={0.92} />
            </mesh>
          </group>
        )),
      )}
      {[-0.63, -0.38, -0.13, 0.13, 0.38, 0.63].map((x) => (
        <Block key={x} at={[x, 0.59, 0.53]} size={[0.13, 0.15, 0.1]} color={colors.cream} />
      ))}
      <mesh position={[0, -0.005, 0.9]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.25, 0.45, 1]}>
        <circleGeometry args={[0.7, 40]} />
        <meshStandardMaterial color={colors.water} roughness={0.24} metalness={0.25} />
      </mesh>
    </group>
  );
}

function ToriiGate() {
  const lintel = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.96, 0.04);
    shape.quadraticCurveTo(0, -0.11, 0.96, 0.04);
    shape.lineTo(1, 0.18);
    shape.quadraticCurveTo(0, 0.02, -1, 0.18);
    shape.closePath();
    return shape;
  }, []);
  return (
    <group position={[0, 0.05, -0.12]}>
      {[-0.62, 0.62].map((x) => (
        <group key={x}>
          <Cylinder at={[x, 0.72, 0]} radius={0.075} top={0.065} height={1.44} color="#9c3f34" />
          <Cylinder at={[x, 0.12, 0]} radius={0.09} height={0.24} color={colors.forest} />
        </group>
      ))}
      <mesh position={[0, 1.43, -0.08]} castShadow>
        <extrudeGeometry
          args={[
            lintel,
            {
              depth: 0.16,
              bevelEnabled: true,
              bevelSize: 0.018,
              bevelThickness: 0.018,
              bevelSegments: 2,
            },
          ]}
        />
        <meshStandardMaterial color="#ac4b3a" roughness={0.85} />
      </mesh>
      <Block at={[0, 1.18, 0]} size={[1.69, 0.1, 0.13]} color="#8e3d30" />
      <Block at={[0, 1.32, 0]} size={[0.1, 0.27, 0.1]} color={colors.forest} />
      <Block at={[0, 0.04, 0.47]} size={[1.06, 0.08, 0.96]} color={colors.stone} />
      <Tree at={[-1.02, 0.02, -0.51]} scale={1.02} slender />
      <Tree at={[1, 0.02, -0.6]} scale={0.94} slender />
    </group>
  );
}

function RoundTower() {
  return (
    <group position={[0, 0.05, -0.17]}>
      <Cylinder at={[0, 0.86, 0]} radius={0.42} height={1.72} color={colors.wall} />
      {[0.38, 0.78, 1.18].flatMap((y) =>
        [-0.17, 0.17].map((x) => (
          <Block
            key={`${x}:${y}`}
            at={[x, y, 0.393]}
            size={[0.09, 0.17, 0.025]}
            color={colors.window}
          />
        )),
      )}
      <Cylinder at={[0, 1.76, 0]} radius={0.47} height={0.1} color={colors.cream} />
      <Cylinder at={[0, 1.94, 0]} radius={0.33} height={0.26} color={colors.forest} />
      <mesh position={[0, 2.12, 0]} castShadow>
        <sphereGeometry args={[0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#345d5d" roughness={0.6} metalness={0.4} />
      </mesh>
      <Tree at={[-0.93, 0.02, -0.5]} scale={0.8} />
      <Bench at={[0.73, 0.02, 0.52]} rotation={-0.3} />
    </group>
  );
}

function Terrain({ variant, textures }: { variant: number; textures: TerrainTextures }) {
  const { surface, cliff } = useMemo(() => createIslandTerrain(variant), [variant]);
  useEffect(
    () => () => {
      surface.dispose();
      cliff.dispose();
    },
    [surface, cliff],
  );
  return (
    <>
      <mesh geometry={cliff} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          map={textures.rock}
          bumpMap={textures.height}
          bumpScale={0.055}
          roughness={0.95}
          flatShading
        />
      </mesh>
      <mesh geometry={surface} castShadow receiveShadow>
        <meshStandardMaterial
          attach="material-0"
          map={textures.grass}
          color={variant % 2 ? "#c3d2b2" : "white"}
          bumpMap={textures.height}
          bumpScale={0.035}
          roughness={1}
        />
        <meshStandardMaterial
          attach="material-1"
          map={textures.grass}
          bumpMap={textures.height}
          bumpScale={0.05}
          roughness={1}
        />
      </mesh>
      <Pebble at={[-0.88, 0.07, 0.78]} scale={[0.65, 0.35, 0.8]} />
      <Pebble at={[0.4, -0.58, 1.05]} scale={[0.55, 0.36, 0.7]} color={colors.earth} />
      <mesh position={[0.12, 0.055, 0.87]} rotation={[-Math.PI / 2, 0, -0.1]} receiveShadow>
        <circleGeometry args={[0.29, 32]} />
        <meshStandardMaterial color={colors.path} roughness={1} />
      </mesh>
    </>
  );
}

function Island({
  node,
  index,
  position,
  selected,
  reduced,
  onSelect,
  labelAcross,
  textures,
  labels,
}: {
  node: JourneySceneNode;
  index: number;
  position: Point;
  selected: boolean;
  reduced: boolean;
  onSelect: (id: string) => void;
  labelAcross: number;
  textures: TerrainTextures;
  labels: HTMLDivElement;
}) {
  const [hovered, setHovered] = useState(false);
  const body = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  useCursor(hovered, "pointer", "auto");
  useEffect(() => {
    const lift = hovered ? 0.16 : selected ? 0.1 : 0;
    if (reduced && body.current) body.current.position.y = lift;
    invalidate();
  }, [hovered, selected, reduced, invalidate]);
  useFrame((_, delta) => {
    if (!body.current) return;
    const target = hovered ? 0.16 : selected ? 0.1 : 0;
    body.current.position.y = reduced
      ? target
      : THREE.MathUtils.damp(body.current.position.y, target, 8, Math.min(delta, 0.1));
    if (Math.abs(body.current.position.y - target) > 0.001) invalidate();
  });
  const choose = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(node.id);
  };
  const miniatures = { cafe: Cafe, culture: Gallery, food: Food, outdoors: Garden, shop: Bookshop };
  const landmarks = {
    "eiffel-tower": EiffelTower,
    "belem-tower": BelemTower,
    "torii-gate": ToriiGate,
    "round-tower": RoundTower,
  };
  const Miniature = node.landmark ? landmarks[node.landmark] : miniatures[node.category];
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.04, 0]}>
        <ringGeometry args={[1.61, 1.635, 72]} />
        <meshBasicMaterial
          color="#70b6d7"
          transparent
          opacity={selected ? 0.65 : hovered ? 0.32 : 0}
          depthWrite={false}
        />
      </mesh>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three.js geometry mirrors the accessible HTML selection button. */}
      <group
        ref={body}
        name="island-body"
        position={[0, reduced ? 0 : -0.18, 0]}
        onClick={choose}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <Terrain variant={node.day ? node.day.number - 1 : index} textures={textures} />
        <Miniature />
        {node.category !== "outdoors" && (
          <pointLight
            position={[0.1, 0.62, 0.5]}
            color="#ffb86e"
            intensity={0.65}
            distance={2.8}
            decay={2}
          />
        )}
        <Html
          portal={{ current: labels }}
          center
          position={groundPoint(labelAcross, -1.55, -0.9)}
          style={{ transform: "translate3d(-50%,0,0)" }}
          className="journey-node-label"
          zIndexRange={[20, 1]}
        >
          {node.day ? (
            <button
              type="button"
              data-day-id={node.id}
              data-landmark={node.landmark}
              className="day-island-label"
              style={{ position: "static", transform: "none", pointerEvents: "auto" }}
              aria-label={`Open ${node.day.label} in ${node.day.city}`}
              aria-current={selected ? "step" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node.id);
              }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
            >
              <span>DAY {String(node.day.number).padStart(2, "0")}</span>
              <strong>{node.day.city}</strong>
              <small>
                {node.day.visits} {node.day.visits === 1 ? "visit" : "visits"}
              </small>
            </button>
          ) : (
            <button
              type="button"
              data-stop-id={node.id}
              data-landmark={node.landmark}
              className={`journey-node-button${selected ? " selected" : ""}`}
              aria-pressed={selected}
              aria-label={`${node.name}, ${node.time}, ${node.duration} minutes${node.pinned ? ", Pinned" : ""}${node.timeLocked ? ", Time fixed" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
            >
              <span className="journey-node-time">
                {node.time}
                <span>{node.duration} min</span>
              </span>
              <strong>{node.name}</strong>
              <span className="journey-node-category">
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {node.category}
                <span aria-hidden="true">↗</span>
              </span>
              {(node.pinned || node.timeLocked) && (
                <span className="journey-node-anchors">
                  {node.pinned ? "Pinned" : ""}
                  {node.pinned && node.timeLocked ? " · " : ""}
                  {node.timeLocked ? "Time fixed" : ""}
                </span>
              )}
            </button>
          )}
        </Html>
      </group>
    </group>
  );
}

function JourneyPath({ positions }: { positions: Point[] }) {
  const instances = useRef<THREE.InstancedMesh>(null);
  const { curves, dots } = useMemo(() => {
    const curves: THREE.CatmullRomCurve3[] = [];
    const dots: THREE.Vector3[] = [];
    for (let index = 0; index < positions.length - 1; index++) {
      const from = positions[index];
      const to = positions[index + 1];
      if (!from || !to) continue;
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      const direction = b.clone().sub(a).normalize();
      const start = a.addScaledVector(direction, 1.56).setY(-0.17);
      const end = b.addScaledVector(direction, -1.56).setY(-0.17);
      const bend = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(
        index % 2 ? -0.4 : 0.4,
      );
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().lerp(end, 0.35).add(bend).setY(-0.06),
        start.clone().lerp(end, 0.72).add(bend).setY(-0.06),
        end,
      ]);
      curves.push(curve);
      dots.push(...curve.getSpacedPoints(Math.max(4, Math.ceil(curve.getLength() / 0.18))));
    }
    return { curves, dots };
  }, [positions]);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!instances.current) return;
    const marker = new THREE.Object3D();
    dots.forEach((point, index) => {
      marker.position.copy(point);
      marker.updateMatrix();
      instances.current?.setMatrixAt(index, marker.matrix);
    });
    instances.current.instanceMatrix.needsUpdate = true;
    instances.current.computeBoundingSphere();
    invalidate();
  }, [dots, invalidate]);
  if (dots.length === 0) return null;
  return (
    <group>
      {curves.map((curve) => (
        <mesh key={JSON.stringify(curve.points)}>
          <tubeGeometry args={[curve, 36, 0.008, 5, false]} />
          <meshBasicMaterial color="#5b93ae" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={instances} args={[undefined, undefined, dots.length]}>
        <sphereGeometry args={[0.026, 8, 6]} />
        <meshStandardMaterial
          color="#a4c8d5"
          emissive="#3a6f8e"
          emissiveIntensity={0.45}
          roughness={0.8}
        />
      </instancedMesh>
    </group>
  );
}

function Cloud({
  position,
  scale = 1,
  side,
  transitionKey,
  reduced,
}: {
  position: Point;
  scale?: number;
  side: number;
  transitionKey: string;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const initialPosition = useRef(position);
  const progress = useRef(1);
  const start = useRef(new THREE.Vector3(...position));
  const [x, y, z] = position;
  const target = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z]);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!group.current) return;
    start.current.copy(group.current.position);
    progress.current = reduced ? 1 : 0;
    if (reduced) {
      group.current.position.copy(target);
      group.current.scale.setScalar(scale);
    }
    // A selected village draws mist toward the lens, then releases it to the sides.
    if (transitionKey || !reduced) invalidate();
  }, [transitionKey, target, reduced, scale, invalidate]);
  useFrame((_, delta) => {
    if (!group.current || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + Math.min(delta, 0.1) / 0.7);
    const t = progress.current;
    const cover = Math.sin(t * Math.PI);
    group.current.position
      .copy(start.current)
      .lerp(target, t * t * (3 - 2 * t))
      .addScaledVector(screenRight, -side * 2.4 * cover)
      .addScaledVector(viewDirection, 1.6 * cover)
      .addScaledVector(screenUp, 0.35 * cover);
    group.current.scale.setScalar(scale * (1 + cover * 1.1));
    if (t < 1) invalidate();
  });
  return (
    <group ref={group} position={initialPosition.current} scale={scale}>
      {(
        [
          [0, 0, 0, 0.57],
          [-0.42, -0.06, 0.03, 0.41],
          [0.43, -0.08, 0.04, 0.38],
        ] as [number, number, number, number][]
      ).map(([px, py, pz, radius]) => (
        <mesh key={px} position={[px, py, pz]} scale={[1.2, 0.43, 0.65]}>
          <sphereGeometry args={[radius, 20, 12]} />
          <meshStandardMaterial
            color="#637d98"
            roughness={1}
            transparent
            opacity={0.44}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({
  positions,
  nodes,
  selectedIndex,
  reduced,
  focused,
}: {
  positions: Point[];
  nodes: JourneySceneNode[];
  selectedIndex: number;
  reduced: boolean;
  focused: boolean;
}) {
  const { camera, size, invalidate } = useThree();
  const currentTarget = useRef(new THREE.Vector3());
  const initialized = useRef(false);
  const target = useMemo(() => {
    const compact = focused && positions.length === 1 && size.height < 260;
    let left = Number.POSITIVE_INFINITY,
      right = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY,
      top = Number.NEGATIVE_INFINITY;
    for (const [index, position] of positions.entries()) {
      const point = new THREE.Vector3(...position);
      const across = point.dot(screenRight);
      const vertical = point.dot(screenUp);
      left = Math.min(left, across - 1.74);
      right = Math.max(right, across + 1.74);
      bottom = Math.min(bottom, vertical - 1.8);
      const height =
        nodes[index]?.landmark === "eiffel-tower" ? 2.85 : nodes[index]?.landmark ? 2.4 : 2.05;
      top = Math.max(top, vertical + height);
    }
    const zoom = Math.max(
      8,
      Math.min(
        80,
        (size.width - (compact ? 8 : 44)) / ((right - left) * 1.05),
        (size.height - (compact ? 16 : 128)) / ((top - bottom) * 1.08),
      ),
    );
    // Reserve more room beneath terrain for its fixed-size semantic HTML label.
    const center = screenRight
      .clone()
      .multiplyScalar((left + right) / 2)
      .addScaledVector(screenUp, (bottom + top) / 2 - (compact ? 0 : 34 / zoom));
    const selected = positions[selectedIndex];
    if (selected)
      center.lerp(new THREE.Vector3(...selected).add(new THREE.Vector3(0, 0.2, 0)), 0.045);
    return {
      center,
      position: center.clone().addScaledVector(viewDirection, 24),
      zoom: zoom * (selected ? 1.018 : 1),
    };
  }, [positions, nodes, selectedIndex, size.width, size.height, focused]);
  useEffect(() => {
    if (reduced || !initialized.current) {
      currentTarget.current.copy(target.center);
      camera.position.copy(target.position);
      camera.lookAt(target.center);
      if (camera instanceof THREE.OrthographicCamera) {
        camera.zoom = target.zoom;
        camera.updateProjectionMatrix();
      }
      initialized.current = true;
    }
    invalidate();
  }, [camera, target, reduced, invalidate]);
  useFrame((_, delta) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const fraction = reduced ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 5);
    camera.position.lerp(target.position, fraction);
    currentTarget.current.lerp(target.center, fraction);
    camera.zoom = THREE.MathUtils.lerp(camera.zoom, target.zoom, fraction);
    camera.lookAt(currentTarget.current);
    camera.updateProjectionMatrix();
    if (
      camera.position.distanceTo(target.position) > 0.002 ||
      Math.abs(camera.zoom - target.zoom) > 0.02
    )
      invalidate();
  });
  return null;
}

function JourneyWorld({
  nodes,
  selectedId,
  onSelect,
  dayKey,
  reduced,
  focused = false,
  labels,
}: Omit<SceneProps, "fallback"> & {
  reduced: boolean;
  labels: HTMLDivElement;
}) {
  const aspect = useThree((state) => state.size.width / Math.max(state.size.height, 1));
  const positions = useMemo(() => layout(nodes.length, aspect), [nodes.length, aspect]);
  const textures = useMemo(terrainTextures, []);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const islands = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refit after rendered models or island positions change.
  useLayoutEffect(() => {
    const light = keyLight.current;
    if (!light || !islands.current) return;
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.shadow.updateMatrices(light);
    const camera = light.shadow.camera;
    const bounds = new THREE.Box3();
    const islandBounds = new THREE.Box3();
    for (const island of islands.current.children) {
      const body = island.getObjectByName("island-body");
      if (!body) continue;
      body.updateWorldMatrix(true, true);
      islandBounds.setFromObject(body, true);
      // Fit every model at both ends of its existing arrival/hover lift.
      islandBounds.min.y += -0.18 - body.position.y;
      islandBounds.max.y += 0.16 - body.position.y;
      bounds.union(islandBounds.applyMatrix4(camera.matrixWorldInverse));
    }
    if (bounds.isEmpty()) return;
    const padding = 0.1;
    camera.left = bounds.min.x - padding;
    camera.right = bounds.max.x + padding;
    camera.bottom = bounds.min.y - padding;
    camera.top = bounds.max.y + padding;
    camera.near = Math.max(0.1, -bounds.max.z - padding);
    camera.far = -bounds.min.z + padding;
    camera.updateProjectionMatrix();
    invalidate();
  }, [nodes, positions, invalidate]);
  const selectedPosition = positions[nodes.findIndex((node) => node.id === selectedId)];
  const cloudCenter = selectedPosition
    ? new THREE.Vector3(...selectedPosition).dot(screenBack) * 0.45
    : 0;
  const cloudKey = `${dayKey ?? "day"}:${selectedId ?? "overview"}`;
  useEffect(
    () => () => {
      for (const texture of Object.values(textures)) texture.dispose();
    },
    [textures],
  );
  return (
    <>
      <hemisphereLight args={["#8daed6", "#172c36", 0.85]} />
      <ambientLight color="#7892b4" intensity={0.15} />
      <directionalLight
        ref={keyLight}
        position={[-6, 12, 8]}
        color="#b2d3ff"
        intensity={3.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
        shadow-normalBias={0.035}
      />
      <directionalLight position={[4, 5, -10]} color="#387bc2" intensity={2.1} />
      <CameraRig
        positions={positions}
        nodes={nodes}
        selectedIndex={nodes.findIndex((node) => node.id === selectedId)}
        reduced={reduced}
        focused={focused}
      />
      <JourneyPath positions={positions} />
      <group ref={islands}>
        {nodes.map((node, index) => (
          <Island
            key={`${dayKey ?? "day"}:${node.id}`}
            node={node}
            index={index}
            position={positions[index] ?? origin}
            selected={selectedId === node.id}
            reduced={reduced}
            onSelect={onSelect}
            textures={textures}
            labels={labels}
            labelAcross={
              nodes.length === 1 ? 0 : (index % 2 ? 1 : -1) * (aspect < 0.8 ? 0.65 : 0.35)
            }
          />
        ))}
      </group>
      <Cloud
        position={groundPoint(-3.3, cloudCenter + 2.3, 0.1)}
        scale={0.9}
        side={-1}
        transitionKey={cloudKey}
        reduced={reduced}
      />
      <Cloud
        position={groundPoint(3.5, cloudCenter - 2.2, -0.42)}
        scale={0.75}
        side={1}
        transitionKey={cloudKey}
        reduced={reduced}
      />
      <mesh position={[0, -1.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <shadowMaterial transparent opacity={0.095} depthWrite={false} />
      </mesh>
    </>
  );
}

class JourneyBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function IllustratedJourneyScene({ fallback, ...props }: SceneProps) {
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [labels, setLabels] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    try {
      const probe = document.createElement("canvas");
      const context = probe.getContext("webgl2") || probe.getContext("webgl");
      setReady(Boolean(context));
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setReady(false);
    }
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div
      className="journey-canvas"
      data-renderer={ready && !lost ? "webgl" : "fallback"}
      data-node-count={props.nodes.length}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {/* Html owns its children here, outside the Canvas-managed loading container. */}
      <div
        ref={setLabels}
        className="journey-label-layer"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
      />
      {ready && !lost && labels && props.nodes.length > 0 ? (
        <JourneyBoundary fallback={fallback}>
          <Canvas
            orthographic
            frameloop="demand"
            shadows={{ type: THREE.PCFShadowMap }}
            dpr={[1, 1.5]}
            camera={{ position: [10, 12, 16], zoom: 50, near: 0.1, far: 100 }}
            gl={{ antialias: true, alpha: true }}
            style={{ touchAction: "pan-y" }}
            onCreated={({ gl }) =>
              gl.domElement.addEventListener("webglcontextlost", () => setLost(true), {
                once: true,
              })
            }
          >
            <JourneyWorld {...props} reduced={reduced} labels={labels} />
          </Canvas>
        </JourneyBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}

// Preserve the upstream visit-view contract. DayIslandScene uses the same models
// through IllustratedJourneyScene without introducing a second canonical schedule.
export function JourneyScene({
  trip,
  dayId,
  selectedStopId,
  onSelect,
}: {
  trip: Trip;
  dayId: string;
  selectedStopId: string | null;
  onSelect: (stopId: string) => void;
}) {
  const nodes = useMemo<JourneySceneNode[]>(
    () =>
      trip.stops
        .filter((stop) => stop.dayId === dayId)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .flatMap((stop) => {
          const place = trip.places.find((item) => item.id === stop.placeId);
          return place
            ? [
                {
                  id: stop.id,
                  name: place.name,
                  category: place.category,
                  time: stop.startTime,
                  duration: stop.durationMinutes,
                  pinned: stop.pinned,
                  timeLocked: stop.timeLocked,
                },
              ]
            : [];
        }),
    [trip, dayId],
  );
  return (
    <div
      className="journey-3d-viewport"
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 300 }}
    >
      <IllustratedJourneyScene
        nodes={nodes}
        selectedId={selectedStopId}
        onSelect={onSelect}
        dayKey={dayId}
        fallback={
          <p role="status" style={{ padding: "72px 24px", textAlign: "center" }}>
            3D journey unavailable; use the visit controls below.
          </p>
        }
      />
    </div>
  );
}
