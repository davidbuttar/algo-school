export type Op =
  | { type: "compare"; i: number; j: number }
  | { type: "swap"; i: number; j: number }
  | { type: "overwrite"; i: number; value: number }
  | { type: "markPivot"; i: number }
  | { type: "unmarkPivot"; i: number }
  | { type: "done" };

export async function* bubbleSortOps(arr: number[]): AsyncGenerator<Op> {
  const a = arr.slice();
  const n = a.length;

  for (let end = n - 1; end > 0; end--) {
    let swapped = false;
    for (let i = 0; i < end; i++) {
      yield { type: "compare", i, j: i + 1 };
      if (a[i] > a[i + 1]) {
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        swapped = true;
        yield { type: "swap", i, j: i + 1 };
      }
    }
    if (!swapped) break;
  }
  yield { type: "done" };
}

export async function* mergeSortOps(arr: number[]): AsyncGenerator<Op> {
  const a = arr.slice();
  const aux = a.slice();

  async function* merge(lo: number, mid: number, hi: number): AsyncGenerator<Op> {
    // copy to aux
    for (let k = lo; k <= hi; k++) aux[k] = a[k];

    let i = lo;
    let j = mid + 1;

    for (let k = lo; k <= hi; k++) {
      if (i > mid) {
        a[k] = aux[j++];
        yield { type: "overwrite", i: k, value: a[k] };
      } else if (j > hi) {
        a[k] = aux[i++];
        yield { type: "overwrite", i: k, value: a[k] };
      } else {
        yield { type: "compare", i, j };
        if (aux[j] < aux[i]) {
          a[k] = aux[j++];
          yield { type: "overwrite", i: k, value: a[k] };
        } else {
          a[k] = aux[i++];
          yield { type: "overwrite", i: k, value: a[k] };
        }
      }
    }
  }

  async function* sort(lo: number, hi: number): AsyncGenerator<Op> {
    if (hi <= lo) return;
    const mid = (lo + hi) >> 1;
    yield* sort(lo, mid);
    yield* sort(mid + 1, hi);
    yield* merge(lo, mid, hi);
  }

  yield* sort(0, a.length - 1);
  yield { type: "done" };
}

export async function* quickSortOps(arr: number[]): AsyncGenerator<Op> {
  const a = arr.slice();

  async function* partition(lo: number, hi: number): AsyncGenerator<{ p: number } | Op> {
    const pivotIndex = hi;
    const pivot = a[pivotIndex];
    yield { type: "markPivot", i: pivotIndex };

    let i = lo;
    for (let j = lo; j < hi; j++) {
      yield { type: "compare", i: j, j: pivotIndex };
      if (a[j] < pivot) {
        if (i !== j) {
          [a[i], a[j]] = [a[j], a[i]];
          yield { type: "swap", i, j };
        }
        i++;
      }
    }
    if (i !== pivotIndex) {
      [a[i], a[pivotIndex]] = [a[pivotIndex], a[i]];
      yield { type: "swap", i, j: pivotIndex };
    }
    return { p: i };
  }

  async function* sort(lo: number, hi: number): AsyncGenerator<Op> {
    if (lo >= hi) return;
    // partition yields ops and then returns pivot index
    const gen = partition(lo, hi);
    let p = lo;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        // The return value of the generator contains the pivot position
        p = (value as any)?.p ?? lo;
        break;
      }
      if ((value as any).type) yield value as Op;
    }

    // Clear pivot highlight now that partition is done
    yield { type: "unmarkPivot", i: p };

    yield* sort(lo, p - 1);
    yield* sort(p + 1, hi);
  }

  yield* sort(0, a.length - 1);
  yield { type: "done" };
}