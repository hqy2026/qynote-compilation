import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTfidfVectors, findLinkSuggestions, tokenizeNoteContent } from "../src/analysis";
import { buildEvaluationNotes, evaluationCases } from "../evaluation/link-cases.mjs";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

describe("link recommendation baseline", () => {
  it("measures the current algorithm across 50 controlled cases", () => {
    expect(evaluationCases).toHaveLength(50);
    const notes = buildEvaluationNotes();
    const raw = new Map(notes.map((note) => [note.path, tokenizeNoteContent(note.content)]));
    const vectors = buildTfidfVectors(notes, raw);

    const byKind = new Map<string, { cases: number; top1: number; top3: number; falsePositives: number }>();
    let top1Hits = 0;
    let top3Hits = 0;
    let positiveCases = 0;
    let negativeCases = 0;
    let negativeFalsePositives = 0;
    const failures: Array<{ id: string; kind: string; expected: string | null; actual: string[] }> = [];

    for (const item of evaluationCases) {
      const source = notes.find((note) => note.path === item.sourcePath);
      expect(source).toBeDefined();
      const suggestions = findLinkSuggestions(source!, notes, vectors, 3);
      const actual = suggestions.map((suggestion) => suggestion.targetPath);
      const stats = byKind.get(item.kind) ?? {
        cases: 0,
        top1: 0,
        top3: 0,
        falsePositives: 0
      };
      stats.cases += 1;

      if (item.expected === "target") {
        positiveCases += 1;
        const top1 = actual[0] === item.targetPath;
        const top3 = actual.includes(item.targetPath);
        if (top1) {
          top1Hits += 1;
          stats.top1 += 1;
        }
        if (top3) {
          top3Hits += 1;
          stats.top3 += 1;
        }
        if (!top1) {
          failures.push({ id: item.id, kind: item.kind, expected: item.targetPath, actual });
        }
      } else {
        negativeCases += 1;
        if (actual.length > 0) {
          negativeFalsePositives += 1;
          stats.falsePositives += 1;
          failures.push({ id: item.id, kind: item.kind, expected: null, actual });
        }
      }
      byKind.set(item.kind, stats);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      algorithm: "Intl.Segmenter + TF-IDF cosine",
      totalCases: evaluationCases.length,
      positiveCases,
      negativeCases,
      top1Accuracy: top1Hits / positiveCases,
      top3Recall: top3Hits / positiveCases,
      negativeFalsePositiveRate: negativeFalsePositives / negativeCases,
      byKind: Object.fromEntries(
        [...byKind.entries()].map(([kind, value]) => [
          kind,
          {
            ...value,
            top1Accuracy: percent(value.top1 / value.cases),
            top3Recall: percent(value.top3 / value.cases),
            falsePositiveRate: percent(value.falsePositives / value.cases)
          }
        ])
      ),
      failures: failures.slice(0, 20)
    };

    fs.writeFileSync(
      path.resolve(process.cwd(), "evaluation/baseline-report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report, null, 2));

    expect(positiveCases).toBe(25);
    expect(negativeCases).toBe(25);
    expect(Number.isFinite(report.top1Accuracy)).toBe(true);
    expect(Number.isFinite(report.top3Recall)).toBe(true);
  });
});
