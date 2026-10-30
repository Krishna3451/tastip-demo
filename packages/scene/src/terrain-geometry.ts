import * as THREE from "three";

/** Original terrain with a level building foundation and an eroded outer shoulder. */
export function createIslandTerrain(variant: number) {
  const points = Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;
    const radius =
      1.46 *
      (1 + Math.sin(angle * 3 + variant * 1.7) * 0.13 + Math.cos(angle * 5 + variant) * 0.075);
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.85);
  });
  const shape = new THREE.Shape();
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last) {
    shape.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
    for (let index = 0; index < points.length; index++) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (current && next)
        shape.quadraticCurveTo(
          current.x,
          current.y,
          (current.x + next.x) / 2,
          (current.y + next.y) / 2,
        );
    }
    shape.closePath();
  }
  const outline = shape.getSpacedPoints(48).slice(0, -1);
  const stride = outline.length + 1;
  const surfacePositions = [0, 0.05, 0];
  const surfaceUv = [0.5, 0.5];
  const surfaceIndices: number[] = [];
  // Interior rings stay level beneath architecture; only the outer shoulder undulates.
  for (const [ring, scale] of [0.64, 0.84, 1.055, 1.055].entries()) {
    for (let index = 0; index <= outline.length; index++) {
      const point = outline[index % outline.length];
      if (!point) continue;
      const relief =
        (Math.sin(point.x * 3.4 + variant) + Math.cos(point.y * 4.2 - variant)) *
        0.028 *
        (ring === 0 ? 0 : ring === 1 ? 0.5 : 1);
      const height = ring === 3 ? -0.25 + relief * 0.3 : 0.05 + relief;
      surfacePositions.push(point.x * scale, height, -point.y * scale);
      surfaceUv.push((point.x * scale) / 3.5 + 0.5, (-point.y * scale) / 3.5 + 0.5);
      if (index === outline.length) continue;
      const a = 1 + ring * stride + index;
      if (ring === 0) surfaceIndices.push(0, a, a + 1);
      if (ring < 2) surfaceIndices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const topCount = surfaceIndices.length;
  for (let index = 0; index < outline.length; index++) {
    const a = 1 + 2 * stride + index;
    surfaceIndices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
  }
  const base = surfacePositions.length / 3;
  surfacePositions.push(0, -0.25, 0);
  surfaceUv.push(0.5, 0.5);
  for (let index = 0; index < outline.length; index++) {
    const a = 1 + 3 * stride + index;
    surfaceIndices.push(base, a + 1, a);
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute("position", new THREE.Float32BufferAttribute(surfacePositions, 3));
  surface.setAttribute("uv", new THREE.Float32BufferAttribute(surfaceUv, 2));
  surface.setIndex(surfaceIndices);
  surface.addGroup(0, topCount, 0);
  surface.addGroup(topCount, surfaceIndices.length - topCount, 1);
  surface.computeVertexNormals();
  surface.computeBoundingSphere();

  // Five irregular rock strata form one closed mesh instead of repeated edge boulders.
  const strata = [
    { height: -0.25, scale: 1.02, color: "#c3ad87" },
    { height: -0.44, scale: 1, color: "#beb6a6" },
    { height: -0.72, scale: 0.89, color: "#a2aeb5" },
    { height: -0.98, scale: 0.64, color: "#879ba8" },
    { height: -1.12, scale: 0.29, color: "#728b9c" },
  ];
  const positions: number[] = [];
  const vertexColors: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (const [ring, stratum] of strata.entries()) {
    const color = new THREE.Color(stratum.color);
    for (let index = 0; index <= outline.length; index++) {
      const point = outline[index % outline.length];
      if (!point) continue;
      const angle = (index / outline.length) * Math.PI * 2;
      const fracture =
        1 + Math.sin(angle * 7 + ring * 1.8 + variant) * (ring === 0 ? 0.018 : 0.065);
      const height =
        stratum.height + Math.sin(angle * 5 + ring * 2.3 + variant) * (ring === 0 ? 0.018 : 0.045);
      positions.push(
        point.x * stratum.scale * fracture,
        height,
        -point.y * stratum.scale * fracture,
      );
      const shade = 0.88 + Math.cos(angle * 9 + variant + ring) * 0.1;
      vertexColors.push(color.r * shade, color.g * shade, color.b * shade);
      uv.push((index / outline.length) * 2, (height + 1.18) / 0.93);
      if (ring === strata.length - 1 || index === outline.length) continue;
      const a = ring * stride + index;
      const next = a + 1;
      const b = a + stride;
      const nextB = next + stride;
      indices.push(a, b, next, next, b, nextB);
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, -1.18, 0);
  const bottomColor = new THREE.Color("#526a7b");
  vertexColors.push(bottomColor.r, bottomColor.g, bottomColor.b);
  uv.push(0.5, 0);
  const bottomRing = (strata.length - 1) * stride;
  for (let index = 0; index < outline.length; index++)
    indices.push(bottom, bottomRing + index + 1, bottomRing + index);
  const top = positions.length / 3;
  positions.push(0, -0.25, 0);
  const topColor = new THREE.Color("#c3ad87");
  vertexColors.push(topColor.r, topColor.g, topColor.b);
  uv.push(0.5, 1);
  for (let index = 0; index < outline.length; index++) indices.push(top, index, index + 1);
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  indexed.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  indexed.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const cliff = indexed.toNonIndexed();
  indexed.dispose();
  cliff.computeVertexNormals();
  cliff.computeBoundingSphere();
  return { surface, cliff };
}
