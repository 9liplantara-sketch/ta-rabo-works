/**
 * 黒い扉 GLB から Particle_* を除去し、meshopt 圧縮した .web.glb を書き出す。
 *
 * 使い方: npm run optimize:black-gate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'assets/models/black-gate');

const SOURCES = ['black_gate.glb', 'black_gate_center.glb', 'black_gate_right.glb'];

function isParticleName(name) {
  return !!name && /^Particle[_-]/i.test(name);
}

function stripParticlesRecursive(node) {
  for (const child of [...node.listChildren()]) {
    if (isParticleName(child.getName())) child.dispose();
    else stripParticlesRecursive(child);
  }
  if (isParticleName(node.getName())) node.dispose();
}

async function optimizeOne(srcName) {
  const srcPath = path.join(srcDir, srcName);
  const outName = srcName.replace(/\.glb$/i, '.web.glb');
  const outPath = path.join(srcDir, outName);
  const before = fs.statSync(srcPath).size;

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(srcPath);
  const rootNode = doc.getRoot();

  for (const scene of rootNode.listScenes()) {
    for (const child of [...scene.listChildren()]) stripParticlesRecursive(child);
  }
  for (const node of [...rootNode.listNodes()]) {
    if (isParticleName(node.getName())) node.dispose();
  }

  for (const anim of rootNode.listAnimations()) {
    for (const channel of [...anim.listChannels()]) {
      const name = channel.getTargetNode()?.getName() || '';
      if (!name.startsWith('Door_')) channel.dispose();
    }
  }

  await doc.transform(
    dedup(),
    weld(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  await io.write(outPath, doc);
  const after = fs.statSync(outPath).size;
  return { srcName, outName, before, after };
}

const results = [];
for (const name of SOURCES) results.push(await optimizeOne(name));

for (const r of results) {
  console.log(
    `${r.srcName} → ${r.outName}: ` +
      `${(r.before / 1024).toFixed(0)}KB → ${(r.after / 1024).toFixed(0)}KB ` +
      `(−${(((r.before - r.after) / r.before) * 100).toFixed(1)}%)`,
  );
}
