import { describe, it, expect } from 'vitest';
import {
  calculateAutoLayoutPositions,
  calculateBranchPosition,
  calculateMergePosition,
  getNodeLayoutMetrics,
} from '../nodeLayout';
import type { ChatNode, TopicEdge } from '../../types/flow';

function makeNode(
  id: string,
  x: number,
  y: number,
  width?: number,
  height?: number
): ChatNode {
  return {
    id,
    type: 'chat',
    position: { x, y },
    data: { topic: id },
    style: {
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    },
  };
}

function makeEdge(source: string, target: string): TopicEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'topic',
    data: { label: `${source}->${target}` },
  };
}

describe('calculateBranchPosition', () => {
  it('places the branch to the right of the parent with a 100px gap', () => {
    const parent = makeNode('p1', 100, 200, 400);
    const pos = calculateBranchPosition(parent, 0);
    expect(pos.x).toBe(100 + 400 + 100); // parentX + width + gap
    expect(pos.y).toBe(200); // same y as parent when no children
  });

  it('offsets vertically for each existing child', () => {
    const parent = makeNode('p1', 100, 200, 400);
    const pos0 = calculateBranchPosition(parent, 0);
    const pos1 = calculateBranchPosition(parent, 1);
    const pos2 = calculateBranchPosition(parent, 2);

    expect(pos0.y).toBe(200);
    expect(pos1.y).toBe(200 + 1 * (500 + 40)); // NODE_HEIGHT + VERTICAL_GAP
    expect(pos2.y).toBe(200 + 2 * (500 + 40));
    // All same x
    expect(pos0.x).toBe(pos1.x);
    expect(pos1.x).toBe(pos2.x);
  });

  it('uses default width (400) when style.width is not set', () => {
    const parent = makeNode('p1', 0, 0);
    const pos = calculateBranchPosition(parent, 0);
    expect(pos.x).toBe(0 + 400 + 100);
  });

  it('respects custom parent width', () => {
    const parent = makeNode('p1', 50, 100, 600);
    const pos = calculateBranchPosition(parent, 0);
    expect(pos.x).toBe(50 + 600 + 100);
  });
});

describe('calculateMergePosition', () => {
  it('returns (0, 0) for empty parent array', () => {
    const pos = calculateMergePosition([]);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('places the merge node to the right of a single parent', () => {
    const parent = makeNode('p1', 100, 200, 400, 500);
    const pos = calculateMergePosition([parent]);
    expect(pos.x).toBe(100 + 400 + 100); // rightEdge + gap
    // Vertically centered: (minY + maxY) / 2 - NODE_HEIGHT / 2
    // minY=200, maxY=200+500=700 → center=450, offset=450-250=200
    expect(pos.y).toBe(200);
  });

  it('positions to the right of the rightmost parent', () => {
    const p1 = makeNode('p1', 100, 100, 400, 500);
    const p2 = makeNode('p2', 700, 100, 400, 500); // further right
    const pos = calculateMergePosition([p1, p2]);
    expect(pos.x).toBe(700 + 400 + 100);
  });

  it('centers vertically between topmost and bottommost parents', () => {
    const p1 = makeNode('p1', 100, 0, 400, 500);   // top=0, bottom=500
    const p2 = makeNode('p2', 100, 600, 400, 500);  // top=600, bottom=1100
    const pos = calculateMergePosition([p1, p2]);
    // minY=0, maxY=1100, center=550, offset=550-250=300
    expect(pos.y).toBe(300);
  });

  it('uses default dimensions when style is not provided', () => {
    const parent = makeNode('p1', 0, 0);
    const pos = calculateMergePosition([parent]);
    // Default width=400, default height=500
    expect(pos.x).toBe(0 + 400 + 100);
    // minY=0, maxY=0+500=500, center=250, offset=250-250=0
    expect(pos.y).toBe(0);
  });

  it('handles three parents correctly', () => {
    const p1 = makeNode('p1', 100, 0, 400, 500);     // right=500
    const p2 = makeNode('p2', 200, 300, 500, 500);    // right=700 (rightmost)
    const p3 = makeNode('p3', 50, 800, 400, 500);     // right=450, bottom=1300
    const pos = calculateMergePosition([p1, p2, p3]);
    expect(pos.x).toBe(700 + 100); // rightmost edge + gap
    // minY=0, maxY=1300, center=650, offset=650-250=400
    expect(pos.y).toBe(400);
  });
});

describe('calculateAutoLayoutPositions', () => {
  it('arranges mixed compact and expanded branches without invalid coordinates or overlap', () => {
    const root = makeNode('root', 500, 100, 600, 700);
    const compact = makeNode('compact', 200, 400);
    compact.data.minimized = true;
    compact.style = { width: 'auto', height: 'auto' };
    const collapsed = makeNode('collapsed', 0, 0, 400, 500);
    collapsed.data.collapsed = true;
    const expanded = makeNode('expanded', 0, 600, 450, 800);
    const merge = makeNode('merge', 900, 300);
    const isolated = makeNode('isolated', 20, 900);
    isolated.data.minimized = true;
    isolated.style = { width: 'auto', height: 'auto' };
    let nodes = [root, compact, collapsed, expanded, merge, isolated];
    const edges = [makeEdge('root', 'compact'), makeEdge('root', 'collapsed'),
      makeEdge('root', 'expanded'), makeEdge('compact', 'merge'), makeEdge('expanded', 'merge')];

    for (let pass = 0; pass < 3; pass++) {
      const positions = calculateAutoLayoutPositions(nodes, edges);
      for (const node of nodes) {
        expect(Number.isFinite(positions[node.id].x)).toBe(true);
        expect(Number.isFinite(positions[node.id].y)).toBe(true);
      }
      for (let i = 0; i < nodes.length; i++) {
        for (const other of nodes.slice(i + 1)) {
          const node = nodes[i];
          const a = positions[node.id]; const b = positions[other.id];
          const aSize = getNodeLayoutMetrics(node); const bSize = getNodeLayoutMetrics(other);
          expect(a.x + aSize.width <= b.x || b.x + bSize.width <= a.x ||
            a.y + aSize.height <= b.y || b.y + bSize.height <= a.y).toBe(true);
        }
      }
      expect(positions.compact.x).toBe(700);
      nodes = JSON.parse(JSON.stringify(nodes.map((node) => ({ ...node, position: positions[node.id] }))));
    }
  });

  it('validates CSS sizes and falls back to measured or default dimensions', () => {
    const node = makeNode('node', 0, 0);
    node.style = { width: 'auto', height: '500px' };
    node.measured = { width: 650, height: 700 };
    expect(getNodeLayoutMetrics(node)).toEqual({ width: 650, height: 500 });
    node.style = { width: Infinity, height: NaN };
    node.measured = { width: 0, height: -20 };
    expect(getNodeLayoutMetrics(node)).toEqual({ width: 400, height: 500 });
    node.data.collapsed = true;
    expect(getNodeLayoutMetrics(node)).toEqual({ width: 260, height: 148 });
  });

  it('places root nodes at the leftmost column', () => {
    const root = makeNode('root', 500, 100);
    const child = makeNode('child', 900, 300);
    const positions = calculateAutoLayoutPositions(
      [root, child],
      [makeEdge('root', 'child')]
    );

    expect(positions.root.x).toBe(0);
    expect(positions.child.x).toBeGreaterThan(positions.root.x);
  });

  it('places children one level to the right of their parent', () => {
    const root = makeNode('root', 0, 100);
    const c1 = makeNode('c1', 0, 200);
    const c2 = makeNode('c2', 0, 300);
    const positions = calculateAutoLayoutPositions(
      [root, c1, c2],
      [makeEdge('root', 'c1'), makeEdge('root', 'c2')]
    );

    expect(positions.c1.x).toBeGreaterThan(positions.root.x);
    expect(positions.c2.x).toBe(positions.c1.x);
  });

  it('places merge nodes at deepest parent level + 1', () => {
    const root = makeNode('root', 0, 0);
    const a = makeNode('a', 0, 0);
    const b = makeNode('b', 0, 0);
    const d = makeNode('d', 0, 0);
    const merge = makeNode('merge', 0, 0);
    const edges = [
      makeEdge('root', 'a'),
      makeEdge('root', 'b'),
      makeEdge('a', 'd'),
      makeEdge('a', 'merge'),
      makeEdge('b', 'merge'),
    ];

    const positions = calculateAutoLayoutPositions([root, a, b, d, merge], edges);
    expect(positions.a.x).toBe(positions.b.x);
    expect(positions.merge.x).toBeGreaterThan(positions.a.x);
    expect(positions.merge.x).toBe(positions.d.x);
  });

  it("stacks disconnected subgraphs so they don't overlap", () => {
    const a1 = makeNode('a1', 0, 0, 400, 500);
    const a2 = makeNode('a2', 0, 0, 400, 500);
    const b1 = makeNode('b1', 0, 0, 400, 500);
    const b2 = makeNode('b2', 0, 0, 400, 500);

    const positions = calculateAutoLayoutPositions(
      [a1, a2, b1, b2],
      [makeEdge('a1', 'a2'), makeEdge('b1', 'b2')]
    );

    const componentAIds = ['a1', 'a2'];
    const componentBIds = ['b1', 'b2'];
    const componentABottom = Math.max(
      ...componentAIds.map((id) => positions[id].y + 500)
    );
    const componentBTop = Math.min(...componentBIds.map((id) => positions[id].y));

    expect(componentBTop).toBeGreaterThan(componentABottom);
  });

  it('keeps a single node in place when there are no edges', () => {
    const solo = makeNode('solo', 123, 456);
    const positions = calculateAutoLayoutPositions([solo], []);

    expect(positions.solo).toEqual({ x: 123, y: 456 });
  });
});
