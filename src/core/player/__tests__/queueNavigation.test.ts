// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getSongKey, type Song } from "../../types";
import { resolveQueueStepIndex } from "../queueNavigation";
import { createRuntimeDouble, song } from "./playerTestDoubles";

const makeQueue = (count: number): Song[] =>
  Array.from({ length: count }, (_, index) => song(String(index + 1)));

describe("resolveQueueStepIndex", () => {
  it("顺序模式下前后步进不碰洗牌表", () => {
    const queue = makeQueue(4);
    const double = createRuntimeDouble({ queue });

    expect(resolveQueueStepIndex(double.refs, queue[1], 1)).toBe(2);
    expect(resolveQueueStepIndex(double.refs, queue[0], -1)).toBe(3);
    expect(double.refs.shuffleOrder.current).toBeNull();
  });

  it("随机模式下把洗牌表写回 refs 并持续复用", () => {
    const queue = makeQueue(8);
    const double = createRuntimeDouble({ queue });
    double.refs.playMode.current = "shuffle";

    const target = resolveQueueStepIndex(double.refs, queue[0], 1);
    const order = double.refs.shuffleOrder.current;
    expect(order).not.toBeNull();
    expect([...(order?.keys ?? [])].sort()).toEqual(queue.map(getSongKey).sort());

    // 重复询问"下一首"必须给出同一个答案，否则预加载与真正播放会各放各的。
    expect(resolveQueueStepIndex(double.refs, queue[0], 1)).toBe(target);
    expect(resolveQueueStepIndex(double.refs, queue[0], 1)).toBe(target);
    expect(double.refs.shuffleOrder.current).toBe(order);
  });

  it("随机模式下上一首真正回到上一首", () => {
    const queue = makeQueue(10);
    const double = createRuntimeDouble({ queue });
    double.refs.playMode.current = "shuffle";

    const nextIndex = resolveQueueStepIndex(double.refs, queue[4], 1);
    expect(resolveQueueStepIndex(double.refs, queue[nextIndex], -1)).toBe(4);
  });

  it("队列只是被 patch 成新数组时不重洗", () => {
    const queue = makeQueue(6);
    const double = createRuntimeDouble({ queue });
    double.refs.playMode.current = "shuffle";

    resolveQueueStepIndex(double.refs, queue[0], 1);
    const order = double.refs.shuffleOrder.current;

    double.refs.queue.current = queue.map((item) => ({ ...item, url: "https://cdn/x.mp3" }));
    resolveQueueStepIndex(double.refs, double.refs.queue.current[0], 1);
    expect(double.refs.shuffleOrder.current).toBe(order);
  });

  it("队列成员变化时重建洗牌表并覆盖全部曲目", () => {
    const queue = makeQueue(4);
    const double = createRuntimeDouble({ queue });
    double.refs.playMode.current = "shuffle";

    resolveQueueStepIndex(double.refs, queue[0], 1);
    const order = double.refs.shuffleOrder.current;

    const grown = [...queue, song("99")];
    double.refs.queue.current = grown;
    resolveQueueStepIndex(double.refs, grown[0], 1);

    const rebuilt = double.refs.shuffleOrder.current;
    expect(rebuilt).not.toBe(order);
    expect(rebuilt?.keys).toHaveLength(5);
    expect(new Set(rebuilt?.keys).size).toBe(5);
    expect([...(rebuilt?.keys ?? [])].sort()).toEqual(grown.map(getSongKey).sort());
  });

  it("空队列返回 -1", () => {
    const double = createRuntimeDouble({ queue: [] });
    expect(resolveQueueStepIndex(double.refs, null, 1)).toBe(-1);
    double.refs.playMode.current = "shuffle";
    expect(resolveQueueStepIndex(double.refs, null, -1)).toBe(-1);
  });
});
