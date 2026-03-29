import { useEffect, useMemo, useRef, useState } from "react";
import coachAvatar from "./assets/coach-avatar.png";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "between",
  "could",
  "during",
  "every",
  "from",
  "have",
  "into",
  "just",
  "more",
  "most",
  "other",
  "over",
  "same",
  "some",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

const IDEA_GROUPS = {
  listen: ["listen", "listens", "listening", "hear", "hears", "hearing"],
  present: ["present", "presentation", "presenter", "presenting", "speaker", "speaking"],
  cue: ["cue", "prompt", "hint", "nudge", "reminder"],
  track: ["track", "tracking", "tracked", "follow", "following", "monitor", "monitors"],
  progress: ["progress", "orientation", "oriented", "flow", "structure"],
  anxiety: ["anxiety", "confidence", "confident", "stress", "nervous"],
  skip: ["skip", "skipped", "miss", "missed", "forgot", "forget", "forgotten"],
  recover: ["recover", "recovery", "continue", "resume"],
  realtime: ["realtime", "real", "live", "instant", "instantly"],
  slide: ["slide", "slides", "deck"],
  move: ["move", "advance", "next", "switch"],
  trust: ["trust", "trusted", "trusting", "believe", "believable", "belief", "confidence"],
  audience: ["audience", "follower", "followers", "people", "community"],
  consistency: ["consistency", "consistent", "regular", "regularly", "often", "frequently", "routine"],
  credibility: ["credibility", "credible", "believable", "trustworthy", "informed", "expert", "authority"],
  engagement: ["engagement", "engage", "interaction", "interact", "reply", "replies", "comment", "comments", "conversation", "click", "clicks"],
  niche: ["niche", "positioning", "position", "space", "topic", "area", "category", "lane"],
  strategy: ["strategy", "plan", "planned", "intentional", "roadmap", "approach"],
  analytics: ["analytics", "metrics", "data", "performance", "measure", "measurement", "numbers"],
  content: ["content", "posts", "posting", "publish", "publishing"],
  authority: ["authority", "expertise", "expert", "known", "recognised", "recognized"],
  business: ["business", "model", "pricing", "revenue", "go", "market"],
  sustainability: ["sustainability", "sustainable", "emissions", "carbon", "environment"],
};

const ALERT_DELAY_MS = 1200;
const ALERT_COOLDOWN_MS = 5000;
const AUTO_ADVANCE_DELAY_MS = 1800;
const MANUAL_WARNING_WINDOW_MS = 6000;
const DRIFT_HINT_DELAY_MS = 1200;
const SEMANTIC_COVER_THRESHOLD = 0.42;
const FILLER_WINDOW_MS = 1600;
const END_THOUGHT_WINDOW_MS = 2200;
const JUDGE_MIN_TEXT_LENGTH = 18;
const ACTIVE_SPEECH_HOLD_MS = 900;
const SLIDE_INTRO_GRACE_MS = 3500;
const MIN_CONTEXT_IDEAS_BEFORE_CUE = 3;
const ICON_TO_TEXT_DELAY_MS = 650;
const AUTO_ADVANCE_PAUSE_MS = 1000;
const COACH_STORAGE_KEY = "cue-coach-history-v1";
const COACH_GUIDANCE_HOLD_MS = 6500;
const COACH_ICON_TO_TEXT_DELAY_MS = 1300;

const ICON_MAP = {
  trust: "🤝",
  audience: "👥",
  consistency: "🔁",
  credibility: "🎓",
  authority: "🏆",
  engagement: "💬",
  strategy: "🧠",
  analytics: "📊",
  data: "📊",
  growth: "📈",
  niche: "🎯",
  content: "📝",
  sustainability: "🌿",
  business: "💼",
  pricing: "💰",
  slide: "🪄",
  progress: "🧭",
  track: "🛰️",
  warning: "⚠️",
};

const marketingSteps = [
  {
    eyebrow: "01",
    title: "Upload Your Deck",
    description:
      "Cue reads each slide, identifies content slides, and prepares point-level guidance before you start.",
  },
  {
    eyebrow: "02",
    title: "Rehearse Or Present",
    description:
      "Switch between Live Presentation and Coach Mode depending on whether you need quiet support or deeper rehearsal feedback.",
  },
  {
    eyebrow: "03",
    title: "Improve Over Time",
    description:
      "Coach Mode remembers what you miss most often, spots weak transitions, and helps each rehearsal get sharper.",
  },
];

const marketingFeatures = [
  "Semantic understanding of natural phrasing",
  "Slide-aware coverage and missed-point detection",
  "Coach feedback with rehearsal memory",
  "Optional script guidance that stays flexible",
  "Light live suggestions during practice",
  "Premium, calm interface built for focus",
];

const modeCards = [
  {
    label: "Live Presentation",
    title: "Real-time support that stays out of your way.",
    description:
      "Cue listens while you present, tracks what has been covered on the current slide, and only surfaces a cue when a missed idea actually matters.",
    points: ["Live microphone listening", "Pause-aware cue timing", "Slide-specific coverage tracking"],
  },
  {
    label: "Coach Mode",
    title: "A rehearsal coach that gets smarter with every run.",
    description:
      "Practice with live transcript tracking, script-aware feedback, most-forgotten-point analytics, and a post-session coaching summary.",
    points: ["Missed-point analysis", "Recurring pattern tracking", "Guided practice with history"],
  },
];

const FILLER_PATTERN = /\b(um+|uh+|erm|like|so+|you know)\b/i;
const END_THOUGHT_PATTERN = /\b(next slide|moving on|to wrap up|in summary|overall|that's it|that is it|finally)\b/i;

const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function stemWord(word) {
  let next = word.toLowerCase();
  Object.entries(IDEA_GROUPS).forEach(([canonical, variants]) => {
    if (variants.includes(next)) next = canonical;
  });
  if (next.endsWith("ing") && next.length > 5) return next.slice(0, -3);
  if (next.endsWith("ed") && next.length > 4) return next.slice(0, -2);
  if (next.endsWith("es") && next.length > 4) return next.slice(0, -2);
  if (next.endsWith("s") && next.length > 4) return next.slice(0, -1);
  return next;
}

function unique(values) {
  return [...new Set(values)];
}

function tokenizeIdeas(text) {
  return unique(
    normalize(text)
      .split(" ")
      .map(stemWord)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  );
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildCue(text) {
  const ideas = tokenizeIdeas(text).sort((left, right) => right.length - left.length);
  return ideas[0] || "hint";
}

function splitSlideTitleAndBody(lines) {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (!cleaned.length) return { title: "", bodyLines: [], allLines: [] };
  if (cleaned.length === 1) return { title: cleaned[0], bodyLines: [], allLines: cleaned };

  const [firstLine, ...rest] = cleaned;
  const looksLikeTitle =
    firstLine.length <= 80 && firstLine.split(" ").length <= 8 && !/[.:;]$/.test(firstLine);

  return looksLikeTitle
    ? { title: firstLine, bodyLines: rest, allLines: cleaned }
    : { title: "", bodyLines: cleaned, allLines: cleaned };
}

function isNonContentSlide({ title = "", bodyLines = [], allLines = [] }) {
  const normalizedTitle = normalize(title);
  const normalizedLines = allLines.map((line) => normalize(line)).filter(Boolean);
  const combinedText = normalizedLines.join(" ").trim();
  const totalWords = combinedText ? combinedText.split(" ").filter(Boolean).length : 0;
  const hasOnlyTitle = Boolean(title) && bodyLines.length === 0;
  const sparseLines = allLines.length <= 2;
  const sparseWords = totalWords <= 10;
  const transitionPatterns = [
    /^thank you$/,
    /^thanks$/,
    /^questions$/,
    /^q a$/,
    /^q&a$/,
    /^agenda$/,
    /^overview$/,
    /^introduction$/,
    /^intro$/,
    /^closing$/,
    /^conclusion$/,
  ];
  const titleLooksLikeTransition =
    normalizedTitle && transitionPatterns.some((pattern) => pattern.test(normalizedTitle));

  return hasOnlyTitle || titleLooksLikeTransition || (sparseLines && sparseWords);
}

function buildPresentation(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const slides = [];
  const points = [];

  blocks.forEach((block, slideIndex) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const descriptor = splitSlideTitleAndBody(lines);
    const nonContent = isNonContentSlide(descriptor);
    const sourceLines = nonContent ? [] : descriptor.bodyLines.length ? descriptor.bodyLines : lines;
    const slidePoints = sourceLines.map((line, pointIndex) => {
      const point = {
        id: `${slideIndex}-${pointIndex}-${line}`,
        intendedText: line,
        keyIdeas: tokenizeIdeas(line),
        cue: buildCue(line),
        slideIndex,
        pointIndex,
      };
      points.push(point);
      return point;
    });

    slides.push({
      id: `slide-${slideIndex}`,
      slideIndex,
      title: descriptor.title || "",
      nonContent,
      imageOnly: !slidePoints.length,
      points: slidePoints,
    });
  });

  return { slides, points };
}

function buildPresentationFromPages(pages) {
  const slides = [];
  const points = [];

  pages.forEach((page, slideIndex) => {
    const bodyLines = (page.bodyLines || []).filter(Boolean);
    const nonContent = isNonContentSlide(page);
    const sourceLines = nonContent ? [] : bodyLines;
    const slidePoints = sourceLines.map((line, pointIndex) => {
      const point = {
        id: `${slideIndex}-${pointIndex}-${line}`,
        intendedText: line,
        keyIdeas: tokenizeIdeas(line),
        cue: buildCue(line),
        slideIndex,
        pointIndex,
      };
      points.push(point);
      return point;
    });

    slides.push({
      id: `slide-${slideIndex}`,
      slideIndex,
      title: page.title || "",
      imageOnly: !slidePoints.length,
      nonContent,
      points: slidePoints,
    });
  });

  return { slides, points };
}

async function readPdfTextContent(page) {
  const textContent = { items: [], styles: Object.create(null), lang: null };
  const stream = page.streamTextContent();

  if (stream && Symbol.asyncIterator in stream) {
    for await (const chunk of stream) {
      textContent.lang ??= chunk.lang;
      Object.assign(textContent.styles, chunk.styles);
      textContent.items.push(...chunk.items);
    }
    return textContent;
  }

  const reader = stream?.getReader?.();
  if (!reader) {
    throw new Error("This browser does not support the PDF text reader needed for uploads.");
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    textContent.lang ??= value.lang;
    Object.assign(textContent.styles, value.styles);
    textContent.items.push(...value.items);
  }

  return textContent;
}

function extractPageLines(items) {
  const rows = [];

  items.forEach((item) => {
    const text = String(item.str || "").trim();
    if (!text) return;
    const y = Math.round(item.transform?.[5] || 0);
    const existingRow = rows.find((row) => Math.abs(row.y - y) <= 2);
    if (existingRow) {
      existingRow.parts.push(text);
    } else {
      rows.push({ y, parts: [text] });
    }
  });

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.parts.join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function computeSemanticState(point, transcriptText) {
  const transcriptIdeas = tokenizeIdeas(transcriptText);
  const transcriptSet = new Set(transcriptIdeas);
  const pointSet = new Set(point.keyIdeas);
  const matchedIdeas = point.keyIdeas.filter((idea) => transcriptSet.has(idea));
  const ideaCoverage = point.keyIdeas.length ? matchedIdeas.length / point.keyIdeas.length : 0;
  const union = new Set([...pointSet, ...transcriptSet]);
  const jaccard = union.size ? matchedIdeas.length / union.size : 0;
  const normalizedTranscript = normalize(transcriptText);
  const transcriptTokens = normalizedTranscript.split(" ").filter(Boolean);
  const contextualMatches = point.keyIdeas.filter((idea) => transcriptTokens.includes(idea)).length;
  const contextualBonus = contextualMatches ? Math.min(0.12, contextualMatches * 0.04) : 0;
  const score = Math.min(1, ideaCoverage * 0.72 + jaccard * 0.22 + contextualBonus);

  return { score, covered: score >= SEMANTIC_COVER_THRESHOLD };
}

function countKeywordMatches(keywords, transcriptText) {
  if (!keywords?.length) return 0;
  const transcriptIdeas = new Set(tokenizeIdeas(transcriptText));
  return keywords.filter((keyword) => transcriptIdeas.has(stemWord(keyword))).length;
}

function chooseHintIcon(point, preparedPoint) {
  const rawCandidates = [
    point?.intendedText || "",
    ...(preparedPoint?.keywords || []),
    ...(point?.keyIdeas || []),
    preparedPoint?.cue || "",
    point?.cue || "",
  ].filter(Boolean);

  const normalizedCandidates = rawCandidates.flatMap((value) => tokenizeIdeas(String(value || "")));
  for (const candidate of normalizedCandidates) {
    if (ICON_MAP[candidate]) return ICON_MAP[candidate];
  }
  return "📝";
}

function buildLocalPreparation(presentation) {
  return presentation.slides.reduce((accumulator, slide) => {
    accumulator[slide.id] = {
      summary: slide.imageOnly ? "" : slide.points.map((point) => point.intendedText).join(" "),
      points: slide.points.reduce((pointAccumulator, point) => {
        const keywords = point.keyIdeas.slice(0, 3);
        const localPreparedPoint = { cue: point.cue, keywords };
        pointAccumulator[point.id] = {
          cue: point.cue,
          keywords,
          icon: chooseHintIcon(point, localPreparedPoint),
        };
        return pointAccumulator;
      }, {}),
    };
    return accumulator;
  }, {});
}

function normalizeCoachDisplayText(text = "") {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const lettersOnly = cleaned.replace(/[^A-Za-z]/g, "");
  const uppercaseCount = lettersOnly.replace(/[^A-Z]/g, "").length;
  const mostlyUppercase = lettersOnly.length >= 6 && uppercaseCount / lettersOnly.length >= 0.72;

  if (!mostlyUppercase) return cleaned;

  const lowered = cleaned.toLowerCase();
  return lowered.replace(/(^\w)|([.!?]\s+\w)/g, (match) => match.toUpperCase());
}

function computeOrderedPointCoverage(point, transcriptText, preparedPoint, scriptKeywords = []) {
  const semantic = computeSemanticState(point, transcriptText);
  const preparedKeywords = preparedPoint?.keywords || [];
  const pointKeywordMatches = countKeywordMatches(point.keyIdeas, transcriptText);
  const preparedKeywordMatches = countKeywordMatches(preparedKeywords, transcriptText);
  const scriptKeywordMatches = countKeywordMatches(scriptKeywords, transcriptText);
  const cueIdeas = tokenizeIdeas(preparedPoint?.cue || point.cue || "");
  const cueMatches = countKeywordMatches(cueIdeas, transcriptText);
  const boostedScore = Math.min(
    1,
    semantic.score +
      pointKeywordMatches * 0.12 +
      preparedKeywordMatches * 0.1 +
      scriptKeywordMatches * 0.08 +
      cueMatches * 0.08
  );

  return {
    score: boostedScore,
    covered:
      boostedScore >= 0.52 ||
      semantic.score >= 0.48 ||
      pointKeywordMatches >= Math.min(2, Math.max(1, point.keyIdeas.length)) ||
      (preparedKeywordMatches >= 2 && semantic.score >= 0.32),
  };
}

function getPointStatusFromScore(score) {
  if (score >= 0.52) return "covered";
  if (score >= 0.26) return "partial";
  return "missing";
}

function dedupeCoachLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const cleaned = String(line || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return false;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCoachGuidanceMessage({
  activeSlide,
  checklistPoints,
  metric,
  pauseDetected,
  endThoughtDetected,
  validCueMoment,
  speakingNow,
  historyForgottenPoints,
  session,
  elapsedMs,
}) {
  if (!activeSlide || speakingNow || !metric) return null;
  const patientWindow = elapsedMs < 9000 || metric.spokenWords < 52;
  if (patientWindow && !endThoughtDetected && !pauseDetected) return null;

  const missingPoints = checklistPoints.filter((point) => point.status === "pending");
  const partialPoints = checklistPoints.filter((point) => point.status === "partial");
  const coveredPoints = checklistPoints.filter((point) => point.status === "covered");
  const repeatedSessionMisses = session.slideMetrics
    .flatMap((slideMetric) =>
      Object.entries(slideMetric.pointScores)
        .filter(([, score]) => getPointStatusFromScore(score) !== "covered")
        .map(([pointId]) => slideMetric.pointLabels[pointId])
    )
    .filter((label) => label && missingPoints.some((point) => point.label === label));

  const fillerHeavy = metric.transcript.join(" ").match(FILLER_PATTERN)?.length >= 2;
  const longSlide = elapsedMs > 14000 || metric.spokenWords > 95;
  const repeatedWeakPoint = repeatedSessionMisses[0] || historyForgottenPoints.find((point) => missingPoints.some((item) => item.label === point.label))?.label || "";

  if (endThoughtDetected && missingPoints.length) {
    return {
      key: `move-on-${activeSlide.id}-${missingPoints[0].id}`,
      level: 2,
      levelOne: "Take a beat and finish the open point.",
      levelTwo: "Pause briefly here and land the idea before moving on.",
    };
  }

  if (metric.hesitationCount >= 3 && validCueMoment) {
    return {
      key: `hesitation-${activeSlide.id}`,
      level: 2,
      levelOne: "Take a breath before the next idea.",
      levelTwo: "Slow down slightly here and let the thought land cleanly.",
    };
  }

  if (fillerHeavy && pauseDetected) {
    return {
      key: `filler-${activeSlide.id}`,
      level: 1,
      levelOne: "Ease off the filler words here.",
      levelTwo: "A short pause will sound stronger than filling the space.",
    };
  }

  if (partialPoints.length && longSlide && validCueMoment) {
    return {
      key: `clarity-${activeSlide.id}-${partialPoints[0].id}`,
      level: 1,
      levelOne: "This point could use a little more clarity.",
      levelTwo: "Try stating the next idea a little more directly.",
    };
  }

  if (coveredPoints.length === 1 && checklistPoints.length >= 3 && metric.spokenWords > 60 && missingPoints.length >= 2 && validCueMoment) {
    return {
      key: `overfocus-${activeSlide.id}-${coveredPoints[0].id}`,
      level: 1,
      levelOne: "Balance this slide before adding more detail.",
      levelTwo: "Spread a little more attention across the remaining ideas.",
    };
  }

  if (partialPoints.length && pauseDetected && longSlide) {
    return {
      key: `partial-${activeSlide.id}-${partialPoints[0].id}`,
      level: 1,
      levelOne: "This idea could use a little more emphasis.",
      levelTwo: "Give that unfinished point one clearer line.",
    };
  }

  if (repeatedWeakPoint && validCueMoment && longSlide) {
    return {
      key: `repeat-session-${activeSlide.id}-${normalize(repeatedWeakPoint)}`,
      level: 2,
      levelOne: "This is a point you tend to skip.",
      levelTwo: "Give that recurring point a clean mention here.",
    }
  }

  if (missingPoints.length && validCueMoment && longSlide) {
    return {
      key: `missing-${activeSlide.id}-${missingPoints[0].id}`,
      level: 1,
      levelOne: "One key point is still open.",
      levelTwo: "Come back to it before you move on.",
    };
  }

  return null;
}

function getSlideLabel(slide, index) {
  return slide?.title ? `Slide ${index + 1}: ${slide.title}` : `Slide ${index + 1}`;
}

function getSlidePointSignature(slide) {
  return slide.points.map((point) => point.intendedText).join(" ");
}

function parseScriptSections(scriptText) {
  const normalized = scriptText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphSections = normalized
    .split(/\n\s*\n+/)
    .map((section) =>
      section
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  if (paragraphSections.length > 1) return paragraphSections;

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((sections, line) => {
      const previous = sections[sections.length - 1];
      const looksLikeHeading = line.split(" ").length <= 8 && !/[.!?]$/.test(line);

      if (!previous || looksLikeHeading) {
        sections.push(line);
      } else {
        sections[sections.length - 1] = `${previous} ${line}`.replace(/\s+/g, " ").trim();
      }
      return sections;
    }, []);
}

function buildScriptGuide(scriptText, presentation) {
  const contentSlides = presentation.slides.filter((slide) => !slide.nonContent);
  if (!scriptText.trim() || !contentSlides.length) return {};

  const sections = parseScriptSections(scriptText);
  if (!sections.length) return {};

  return contentSlides.reduce((accumulator, slide, index) => {
    const slideIdeas = new Set(tokenizeIdeas(getSlidePointSignature(slide)));
    const slideTitleIdeas = new Set(tokenizeIdeas(slide.title || ""));
    const bestSection =
      sections
        .map((section, sectionIndex) => {
          const ideas = tokenizeIdeas(section);
          const overlap = ideas.filter((idea) => slideIdeas.has(idea)).length;
          const titleOverlap = ideas.filter((idea) => slideTitleIdeas.has(idea)).length;
          const proportionalIndex = Math.abs(sectionIndex / Math.max(sections.length - 1, 1) - index / Math.max(contentSlides.length - 1, 1));
          const lengthScore = Math.min(0.4, countWords(section) / 120);
          return {
            section,
            score: overlap * 2.4 + titleOverlap * 0.8 + lengthScore - proportionalIndex,
          };
        })
        .sort((left, right) => right.score - left.score)[0]?.section || sections[index] || "";

    const keywords = tokenizeIdeas(bestSection).slice(0, 10);
    accumulator[slide.id] = {
      text: bestSection,
      keywords,
      summary: bestSection.split(".").slice(0, 2).join(". ").trim(),
      wordCount: countWords(bestSection),
    };
    return accumulator;
  }, {});
}

function getInitialCoachHistory() {
  return { sessions: [], pointStats: {}, slideStats: {}, updatedAt: "" };
}

function buildCoachPointStats(slideMetrics) {
  return slideMetrics
    .flatMap((slide) =>
      slide.points
        .filter((point) => point.status === "missing")
        .map((point) => ({
          key: `${slide.slideIndex}-${normalize(point.label)}`,
          label: point.label,
          slideLabel: slide.label,
          count: 1,
        }))
    )
    .sort((left, right) => right.count - left.count);
}

function mergeCoachHistory(history, sessionSummary) {
  const nextHistory = {
    sessions: [sessionSummary.snapshot, ...(history.sessions || [])].slice(0, 12),
    pointStats: { ...(history.pointStats || {}) },
    slideStats: { ...(history.slideStats || {}) },
    updatedAt: new Date().toISOString(),
  };

  sessionSummary.slideBreakdown.forEach((slide) => {
    const slideKey = `${slide.slideIndex}`;
    const previousSlide = nextHistory.slideStats[slideKey] || {
      label: slide.label,
      sessions: 0,
      rushed: 0,
      hesitant: 0,
      weak: 0,
    };
    nextHistory.slideStats[slideKey] = {
      label: slide.label,
      sessions: previousSlide.sessions + 1,
      rushed: previousSlide.rushed + (slide.rushed ? 1 : 0),
      hesitant: previousSlide.hesitant + (slide.hesitationCount > 0 ? 1 : 0),
      weak: previousSlide.weak + (slide.status === "Needs Work" ? 1 : 0),
    };

    slide.points.forEach((point) => {
      const pointKey = `${slide.slideIndex}-${normalize(point.label)}`;
      const previousPoint = nextHistory.pointStats[pointKey] || {
        label: point.label,
        slideLabel: slide.label,
        missed: 0,
        partial: 0,
        covered: 0,
      };
      nextHistory.pointStats[pointKey] = {
        label: point.label,
        slideLabel: slide.label,
        missed: previousPoint.missed + (point.status === "missing" ? 1 : 0),
        partial: previousPoint.partial + (point.status === "partial" ? 1 : 0),
        covered: previousPoint.covered + (point.status === "covered" ? 1 : 0),
      };
    });
  });

  return nextHistory;
}

function createCoachSession(presentation, scriptGuide) {
  const slideMetrics = presentation.slides.map((slide, index) => ({
    slideId: slide.id,
    slideIndex: index,
    label: getSlideLabel(slide, index),
    title: slide.title || "",
    pointIds: slide.points.map((point) => point.id),
    pointLabels: slide.points.reduce((accumulator, point) => {
      accumulator[point.id] = point.intendedText;
      return accumulator;
    }, {}),
    pointScores: slide.points.reduce((accumulator, point) => {
      accumulator[point.id] = 0;
      return accumulator;
    }, {}),
    coveredPointIds: [],
    transcript: [],
    spokenWords: 0,
    hesitationCount: 0,
    outOfOrderCount: 0,
    rushed: false,
    scriptCoverage: 0,
    visitCount: 0,
    durationMs: 0,
    enteredAt: 0,
    liveNotes: [],
    scriptGuide: scriptGuide[slide.id] || null,
  }));

  return {
    startedAt: Date.now(),
    activeSlideIndex: -1,
    slideMetrics,
    transcript: [],
    missedLiveSuggestions: [],
    sessionNotes: [],
    guidanceCounts: {},
    lastGuidanceAt: 0,
  };
}

function finalizeSlideMetric(metric) {
  const activeDuration = metric.enteredAt ? Date.now() - metric.enteredAt : 0;
  metric.durationMs += activeDuration;
  metric.enteredAt = 0;
}

function buildCoachSummary(presentation, coachSession, existingHistory, scriptGuide) {
  coachSession.slideMetrics.forEach((metric) => finalizeSlideMetric(metric));

  const slideBreakdown = presentation.slides.map((slide, index) => {
    const metric = coachSession.slideMetrics[index];
    const points = slide.points.map((point) => {
      const score = metric.pointScores[point.id] || 0;
      let status = "missing";
      if (score >= 0.52) status = "covered";
      else if (score >= 0.26) status = "partial";
      return {
        label: point.intendedText,
        status,
        score: Number(score.toFixed(2)),
      };
    });

    const coveredCount = points.filter((point) => point.status === "covered").length;
    const partialCount = points.filter((point) => point.status === "partial").length;
    const missingCount = points.filter((point) => point.status === "missing").length;
    const expectedScriptWords = metric.scriptGuide?.wordCount || slide.points.length * 18;
    const brief = metric.spokenWords > 0 && metric.spokenWords < Math.max(18, expectedScriptWords * 0.45);
    const rushed = metric.durationMs > 0 && metric.durationMs < Math.max(18000, slide.points.length * 9000);
    const scriptAlignment =
      metric.scriptGuide?.keywords?.length
        ? countKeywordMatches(metric.scriptGuide.keywords, metric.transcript.join(" ")) / metric.scriptGuide.keywords.length
        : null;

    return {
      slideIndex: index,
      label: metric.label,
      status:
        missingCount === 0 ? "Strong" : coveredCount >= Math.max(1, Math.ceil(points.length / 2)) ? "Mixed" : "Needs Work",
      coveredCount,
      partialCount,
      missingCount,
      hesitationCount: metric.hesitationCount,
      outOfOrderCount: metric.outOfOrderCount,
      rushed: rushed || brief,
      spokenWords: metric.spokenWords,
      durationMs: metric.durationMs,
      scriptAlignment: scriptAlignment === null ? null : Number(scriptAlignment.toFixed(2)),
      summary:
        missingCount === 0
          ? "You communicated the main ideas clearly on this slide."
          : missingCount === 1
            ? `One point still needs more emphasis: ${points.find((point) => point.status === "missing")?.label || "a key idea"}.`
            : `Multiple points stayed thin here, especially ${points
                .filter((point) => point.status === "missing")
                .slice(0, 2)
                .map((point) => point.label)
                .join(" and ")}.`,
      points,
    };
  });

  const totalPoints = slideBreakdown.reduce((sum, slide) => sum + slide.points.length, 0);
  const coveredPoints = slideBreakdown.reduce((sum, slide) => sum + slide.coveredCount, 0);
  const partialPoints = slideBreakdown.reduce((sum, slide) => sum + slide.partialCount, 0);
  const overallCoverage = totalPoints ? coveredPoints / totalPoints : 0;
  const strongestSlides = slideBreakdown
    .filter((slide) => slide.status === "Strong")
    .slice(0, 3)
    .map((slide) => slide.label);
  const weakestSlides = [...slideBreakdown]
    .sort((left, right) => right.missingCount + right.hesitationCount - (left.missingCount + left.hesitationCount))
    .filter((slide) => slide.missingCount || slide.hesitationCount || slide.rushed)
    .slice(0, 3)
    .map((slide) => slide.label);

  const mostForgottenPoints = Object.values(
    slideBreakdown.reduce((accumulator, slide) => {
      slide.points
        .filter((point) => point.status === "missing")
        .forEach((point) => {
          const key = `${slide.slideIndex}-${normalize(point.label)}`;
          accumulator[key] = {
            label: point.label,
            slideLabel: slide.label,
            count: (accumulator[key]?.count || 0) + 1,
          };
        });
      return accumulator;
    }, {})
  );

  const historicForgotten = Object.values(existingHistory.pointStats || {})
    .sort((left, right) => right.missed - left.missed)
    .slice(0, 6);

  const recurringPatterns = [];
  if (slideBreakdown.some((slide) => slide.rushed)) recurringPatterns.push("You rush certain slides before the main point fully lands.");
  if (slideBreakdown.some((slide) => slide.hesitationCount > 0))
    recurringPatterns.push("There are hesitation moments before weaker sections, especially when a point is less rehearsed.");
  if (slideBreakdown.some((slide) => slide.outOfOrderCount > 0))
    recurringPatterns.push("You sometimes jump to later bullets before the earlier framing is fully covered.");
  if (historicForgotten.length)
    recurringPatterns.push(`Across rehearsals, ${historicForgotten[0].label} keeps showing up as a forgotten point.`);

  const improvements = [];
  if (mostForgottenPoints.length)
    improvements.push(`Rehearse the forgotten points first: ${mostForgottenPoints
      .slice(0, 3)
      .map((point) => point.label)
      .join(", ")}.`);
  if (slideBreakdown.some((slide) => slide.rushed))
    improvements.push("Give transition slides one extra beat so your setup and handoff sentences feel intentional.");
  if (slideBreakdown.some((slide) => slide.scriptAlignment !== null && slide.scriptAlignment < 0.35))
    improvements.push("Your spoken version drifts from the script on a few slides. Keep the script as a guide for structure, not exact wording.");
  if (slideBreakdown.some((slide) => slide.missingCount === 0))
    improvements.push("Use your strongest slides as a template: they are detailed, calm, and well-ordered.");
  if (slideBreakdown.some((slide) => slide.hesitationCount >= 2))
    improvements.push("Take one short pause before weaker sections so the next idea lands with more confidence.");
  if (coachSession.transcript.join(" ").match(FILLER_PATTERN)?.length >= 3)
    improvements.push("Cut down filler words and let short pauses do the work.");

  const strongestSummary = strongestSlides.length
    ? `Your strongest section${strongestSlides.length === 1 ? " was" : "s were"} ${strongestSlides.join(", ")}.`
    : "This run did not have a fully strong slide yet, but several points were partially covered.";
  const weakestSummary = weakestSlides.length
    ? `The slides needing the most work are ${weakestSlides.join(", ")}.`
    : "No slide stood out as consistently weak in this run.";

  const scriptAlignmentSummary = scriptGuide && Object.keys(scriptGuide).length
    ? slideBreakdown.some((slide) => slide.scriptAlignment !== null && slide.scriptAlignment < 0.35)
      ? "The script helped clarify your intended flow, and Coach Mode noticed a few sections where your spoken delivery shortened or skipped key ideas from it."
      : "Your delivery stayed broadly aligned with the script while still allowing natural phrasing."
    : "No script was provided for this rehearsal.";

  const overallSummary =
    overallCoverage >= 0.82
      ? "Strong rehearsal. You landed most of the meaning across the deck and kept the structure intact."
      : overallCoverage >= 0.6
        ? "Promising rehearsal. The core story is there, but a few important points still need more weight."
        : "Useful rehearsal. Coach Mode found several points that need more structure before the real presentation.";

  const snapshot = {
    recordedAt: new Date().toISOString(),
    overallCoverage: Number((overallCoverage * 100).toFixed(0)),
    strongestSlides,
    weakestSlides,
    mostForgottenPoints: mostForgottenPoints.slice(0, 4),
  };

  const summaryBullets = dedupeCoachLines([
    strongestSlides.length ? `Handled well: ${strongestSlides.slice(0, 2).join(", ")}.` : "",
    (historicForgotten[0] || mostForgottenPoints[0])
      ? `Missed most often: ${normalizeCoachDisplayText((historicForgotten[0] || mostForgottenPoints[0]).label)}.`
      : "",
    improvements[0] || "",
    recurringPatterns[0] || "",
    improvements[1] || "",
  ]).slice(0, 5);

  return {
    overallSummary,
    strongestSummary,
    weakestSummary,
    slideBreakdown,
    strongestSlides,
    weakestSlides,
    mostForgottenPoints,
    historicForgotten,
    improvements: dedupeCoachLines(improvements).slice(0, 4),
    recurringPatterns: dedupeCoachLines(recurringPatterns).slice(0, 4),
    scriptAlignmentSummary,
    score: Math.round((overallCoverage * 100 + (partialPoints / Math.max(totalPoints, 1)) * 10) * 0.95),
    snapshot,
    conciseBullets: summaryBullets,
  };
}

function buildLiveCoachBreakdown(presentation, coachSession) {
  if (!coachSession) return [];

  return presentation.slides.map((slide, index) => {
    const metric = coachSession.slideMetrics[index];
    const coveredCount = slide.points.filter((point) => getPointStatusFromScore(metric?.pointScores?.[point.id] || 0) === "covered").length;
    const partialCount = slide.points.filter((point) => getPointStatusFromScore(metric?.pointScores?.[point.id] || 0) === "partial").length;
    const missingCount = slide.points.length - coveredCount - partialCount;

    return {
      label: getSlideLabel(slide, index),
      coveredCount,
      partialCount,
      missingCount,
      hesitationCount: metric?.hesitationCount || 0,
      rushed: Boolean(metric?.rushed),
    };
  });
}

function isFillerMoment(text) {
  return FILLER_PATTERN.test(text);
}

function isEndThoughtMoment(text) {
  return END_THOUGHT_PATTERN.test(text);
}

function SetupButton({ children, variant = "primary", className = "", ...props }) {
  const styles =
    variant === "secondary"
      ? "bg-white text-[#333333] ring-1 ring-[#ADCAE8]/40 hover:bg-[#F6F8F9]"
      : "bg-[#D95C5C] text-white shadow-[0_20px_50px_rgba(217,92,92,0.22)] hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(217,92,92,0.28)]";

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function SetupCard({ className = "", children }) {
  return (
    <div className={`rounded-[28px] border border-white/70 bg-white/82 shadow-[0_24px_80px_rgba(96,125,139,0.12)] backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

function CoachAvatar({ size = "md", label = "Cue Coach" }) {
  const sizes = {
    sm: "h-14 w-14",
    md: "h-20 w-20",
    lg: "h-28 w-28",
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(173,202,232,0.28),transparent_72%)] blur-xl" />
      <img
        src={coachAvatar}
        alt={label}
        className={`relative aspect-square shrink-0 rounded-full object-cover shadow-[0_18px_50px_rgba(96,125,139,0.18)] ${sizes[size]}`}
      />
    </div>
  );
}

function SectionKicker({ children }) {
  return <p className="text-[11px] uppercase tracking-[0.28em] text-[#1F1F1F]">{children}</p>;
}

function CoachKicker({ children }) {
  return <p className="text-[11px] uppercase tracking-[0.14em] text-[#333333]/58">{children}</p>;
}

export default function App() {
  const initialPresentation = useMemo(() => buildPresentation(""), []);

  const [phase, setPhase] = useState("setup");
  const [mode, setMode] = useState("live");
  const [coachFeedbackStyle, setCoachFeedbackStyle] = useState("summary");
  const [presentation, setPresentation] = useState(initialPresentation);
  const [preparedSlides, setPreparedSlides] = useState(buildLocalPreparation(initialPresentation));
  const [uploadedPresentation, setUploadedPresentation] = useState(null);
  const [uploadedPreparedSlides, setUploadedPreparedSlides] = useState(null);
  const [localCoveredPoints, setLocalCoveredPoints] = useState({});
  const [aiCoveredPoints, setAiCoveredPoints] = useState({});
  const [cuedPoints, setCuedPoints] = useState({});
  const [lastFinalTranscript, setLastFinalTranscript] = useState("");
  const [recentMatchDebug, setRecentMatchDebug] = useState([]);
  const [preparing, setPreparing] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [transcriptPanelPosition, setTranscriptPanelPosition] = useState({ x: 16, y: 16 });
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [checklistCompact, setChecklistCompact] = useState(true);
  const [presentationNow, setPresentationNow] = useState(Date.now());
  const [spokenCorpus, setSpokenCorpus] = useState("");
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [sessionState, setSessionState] = useState("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Upload your deck, choose a mode, and start when Cue is ready."
  );
  const [hintBubble, setHintBubble] = useState({ visible: false, text: "", icon: "", tone: "idle" });
  const [cueState, setCueState] = useState({
    currentCue: "",
    cueType: "icon",
    cueVisible: false,
    cueTargetPoint: "",
    cueTriggeredAt: 0,
    cueResolved: false,
    cueDismissed: false,
    cueIcon: "",
    cueKeyword: "",
  });
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfName, setPdfName] = useState("No PDF uploaded");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [uploadState, setUploadState] = useState("idle");
  const [uploadError, setUploadError] = useState("");
  const [uploadPromptVisible, setUploadPromptVisible] = useState(false);
  const [uploadHighlight, setUploadHighlight] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [manualWarning, setManualWarning] = useState({ direction: "", armedAt: 0 });
  const [coachScript, setCoachScript] = useState("");
  const [scriptExpanded, setScriptExpanded] = useState(false);
  const [coachHistory, setCoachHistory] = useState(getInitialCoachHistory());
  const [coachSummary, setCoachSummary] = useState(null);
  const [coachLiveTip, setCoachLiveTip] = useState("");
  const [slideBreakdownVisible, setSlideBreakdownVisible] = useState(false);

  const recognitionRef = useRef(null);
  const bubbleTimerRef = useRef(null);
  const sessionStateRef = useRef("idle");
  const lastSpeechAtRef = useRef(Date.now());
  const lastSpeechActivityAtRef = useRef(Date.now());
  const lastFillerAtRef = useRef(0);
  const lastThoughtAtRef = useRef(0);
  const lastHintAtRef = useRef(0);
  const lastSlideChangeAtRef = useRef(Date.now());
  const slideStartedAtRef = useRef(Date.now());
  const lastAutoAdvanceKeyRef = useRef("");
  const lastJudgeSignatureRef = useRef("");
  const presentationRef = useRef(null);
  const transcriptDragRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const coachPdfCanvasRef = useRef(null);
  const coachPdfViewportRef = useRef(null);
  const transcriptRef = useRef([]);
  const coverageRef = useRef({});
  const slidesRef = useRef([]);
  const activeSlideIndexRef = useRef(0);
  const preparedSlidesRef = useRef({});
  const uploadSectionRef = useRef(null);
  const uploadHighlightTimerRef = useRef(null);
  const coachSessionRef = useRef(null);
  const coachLiveTipRef = useRef("");
  const coachPdfDocumentRef = useRef(null);

  const slides = presentation.slides;
  const points = presentation.points;
  const scriptGuide = useMemo(() => buildScriptGuide(coachScript, uploadedPresentation || presentation), [coachScript, presentation, uploadedPresentation]);

  const semanticStates = useMemo(
    () =>
      points.reduce((accumulator, point) => {
        accumulator[point.id] = computeSemanticState(point, spokenCorpus);
        return accumulator;
      }, {}),
    [points, spokenCorpus]
  );

  const coverage = useMemo(
    () =>
      points.reduce((accumulator, point) => {
        accumulator[point.id] = Boolean(localCoveredPoints[point.id]) || Boolean(aiCoveredPoints[point.id]);
        return accumulator;
      }, {}),
    [aiCoveredPoints, localCoveredPoints, points]
  );

  const slideStates = useMemo(
    () =>
      slides.map((slide) => {
        const pendingPoints = slide.points.filter((point) => !coverage[point.id]);
        return {
          slideIndex: slide.slideIndex,
          imageOnly: Boolean(slide.imageOnly),
          nonContent: Boolean(slide.nonContent),
          pendingPoints,
          complete: !slide.nonContent && (slide.points.length === 0 || pendingPoints.length === 0),
          targetPoint: pendingPoints[0] || null,
        };
      }),
    [coverage, slides]
  );

  const activeSlide = slides[activeSlideIndex] || null;
  const activeSlideState = slideStates[activeSlideIndex] || null;
  const activePoint = activeSlideState?.targetPoint || null;
  const recentTranscriptText = transcript.slice(-5).join(" ");
  const nextSlide = slides[activeSlideIndex + 1] || null;
  const currentPdfPage = pdfPageCount ? Math.min(activeSlideIndex + 1, pdfPageCount) : activeSlideIndex + 1;
  const coveredCount = useMemo(() => Object.values(coverage).filter(Boolean).length, [coverage]);
  const transcriptIdeaCount = tokenizeIdeas(recentTranscriptText).length;
  const speakingNow = presentationNow - lastSpeechActivityAtRef.current < ACTIVE_SPEECH_HOLD_MS;
  const coveredPointLabels = activeSlide ? activeSlide.points.filter((point) => coverage[point.id]).map((point) => point.intendedText) : [];
  const missingPointLabels = activeSlideState ? activeSlideState.pendingPoints.map((point) => point.intendedText) : [];
  const nextCueCandidate = activePoint ? preparedSlides[activeSlide?.id]?.points?.[activePoint.id]?.cue || activePoint.cue : "";
  const checklistPoints = activeSlide
    ? activeSlide.nonContent
      ? []
      : activeSlide.points.map((point) => {
          const currentScore = coachSessionRef.current?.slideMetrics?.[activeSlideIndex]?.pointScores?.[point.id] || semanticStates[point.id]?.score || 0;
          const status = coverage[point.id]
            ? "covered"
            : currentScore >= 0.26
              ? "partial"
              : cuedPoints[point.id]
                ? "cued"
                : "pending";
          return {
            id: point.id,
            label: point.intendedText,
            displayLabel: normalizeCoachDisplayText(point.intendedText),
            status,
            score: Number(currentScore.toFixed(2)),
          };
        })
    : [];
  const slideComplete = Boolean(activeSlideState?.complete);
  const autoAdvanceReady =
    slideComplete &&
    !speakingNow &&
    presentationNow - lastSpeechAtRef.current >= AUTO_ADVANCE_PAUSE_MS &&
    presentationNow - lastSlideChangeAtRef.current >= AUTO_ADVANCE_DELAY_MS;
  const compactCompletedCount = checklistPoints.filter((point) => point.status === "covered").length;
  const hasUploadedPresentation = Boolean(pdfUrl);
  const currentSlideLabel = activeSlide ? getSlideLabel(activeSlide, activeSlideIndex) : "No slide";
  const currentSlideDisplayLabel = normalizeCoachDisplayText(currentSlideLabel);
  const bestRecentMatch = recentMatchDebug[0] || null;
  const earliestMissingPoint = activeSlideState?.pendingPoints?.[0] || null;
  const earliestMissingPointLabel = normalizeCoachDisplayText(earliestMissingPoint?.intendedText || "");
  const cuePreparedPoint = earliestMissingPoint && activeSlide ? preparedSlides[activeSlide.id]?.points?.[earliestMissingPoint.id] : null;
  const cueSourceIcon = earliestMissingPoint ? cuePreparedPoint?.icon || chooseHintIcon(earliestMissingPoint, cuePreparedPoint) : "";
  const cueSourceKeyword = earliestMissingPoint ? cuePreparedPoint?.cue || earliestMissingPoint.cue || "" : "";
  const pauseDetected = presentationNow - lastSpeechAtRef.current >= ALERT_DELAY_MS;
  const fillerDetected = presentationNow - lastFillerAtRef.current <= FILLER_WINDOW_MS;
  const endThoughtDetected = presentationNow - lastThoughtAtRef.current <= END_THOUGHT_WINDOW_MS;
  const validCueMoment = !speakingNow && (pauseDetected || fillerDetected || endThoughtDetected);
  const slideStatusLabel = earliestMissingPoint
    ? checklistPoints.some((point) => point.status === "partial")
      ? "Partial"
      : "Missing"
    : "Covered";
  const nextSaySuggestion = earliestMissingPoint
    ? checklistPoints.some((point) => point.status === "partial")
      ? `Clarify ${earliestMissingPoint.intendedText}.`
      : `Say ${earliestMissingPoint.intendedText} next.`
    : "You can move on when ready.";
  const nextSayDisplay = normalizeCoachDisplayText(nextSaySuggestion);
  const bestRecentMatchLabel = normalizeCoachDisplayText(bestRecentMatch?.label || "");
  const coachShowsLiveGuidance = coachFeedbackStyle === "live";
  const activeCoachCueVisible = cueState.cueVisible;
  const coachCueDisplay =
    cueState.cueType === "icon" ? cueState.cueIcon || cueState.currentCue : cueState.cueKeyword || cueState.currentCue;
  const historyForgottenPoints = useMemo(
    () =>
      Object.values(coachHistory.pointStats || {})
        .sort((left, right) => right.missed - left.missed)
        .slice(0, 5),
    [coachHistory]
  );
  const historyInsights = useMemo(() => {
    const slidesOverTime = Object.values(coachHistory.slideStats || {});
    const insights = [];
    if (historyForgottenPoints.length) {
      insights.push(`Most forgotten point so far: ${historyForgottenPoints[0].label}.`);
    }
    const rushedSlide = slidesOverTime.sort((left, right) => right.rushed - left.rushed)[0];
    if (rushedSlide?.rushed) {
      insights.push(`${rushedSlide.label} is often rushed across rehearsals.`);
    }
    const hesitantSlide = slidesOverTime.sort((left, right) => right.hesitant - left.hesitant)[0];
    if (hesitantSlide?.hesitant) {
      insights.push(`${hesitantSlide.label} tends to trigger hesitation more than other slides.`);
    }
    return insights.slice(0, 3);
  }, [coachHistory, historyForgottenPoints]);
  const liveCoachBreakdown = useMemo(
    () => (mode === "coach" ? buildLiveCoachBreakdown(presentation, coachSessionRef.current) : []),
    [activeSlideIndex, aiCoveredPoints, localCoveredPoints, mode, presentation, transcript]
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COACH_STORAGE_KEY);
      if (stored) {
        setCoachHistory(JSON.parse(stored));
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(coachHistory));
    } catch {}
  }, [coachHistory]);

  useEffect(() => {
    return () => {
      stopSessionInputs();
      window.clearTimeout(bubbleTimerRef.current);
      window.clearTimeout(uploadHighlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenActive(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (phase !== "present") return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        attemptSlideMove("next");
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        attemptSlideMove("previous");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, activeSlideIndex, activeSlideState, slides.length, manualWarning]);

  useEffect(() => {
    if (phase !== "present") return undefined;

    const handlePointerMove = (event) => {
      if (!transcriptDragRef.current) return;
      const nextX = Math.max(8, event.clientX - transcriptDragRef.current.offsetX);
      const nextY = Math.max(8, event.clientY - transcriptDragRef.current.offsetY);
      setTranscriptPanelPosition({ x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      transcriptDragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "present") return undefined;
    const intervalId = window.setInterval(() => setPresentationNow(Date.now()), 250);
    return () => window.clearInterval(intervalId);
  }, [phase]);

  useEffect(() => {
    if (!transcriptScrollRef.current) return;
    const element = transcriptScrollRef.current;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    if (nearBottom || transcriptExpanded === false) {
      element.scrollTop = element.scrollHeight;
    }
  }, [interimTranscript, transcript, transcriptExpanded]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    coverageRef.current = coverage;
  }, [coverage]);

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex;
    if (mode === "coach" && coachSessionRef.current && phase === "present") {
      const session = coachSessionRef.current;
      if (session.activeSlideIndex !== activeSlideIndex) {
        if (session.activeSlideIndex >= 0) finalizeSlideMetric(session.slideMetrics[session.activeSlideIndex]);
        session.activeSlideIndex = activeSlideIndex;
        session.slideMetrics[activeSlideIndex].visitCount += 1;
        session.slideMetrics[activeSlideIndex].enteredAt = Date.now();
      }
    }
  }, [activeSlideIndex, mode, phase]);

  useEffect(() => {
    preparedSlidesRef.current = preparedSlides;
  }, [preparedSlides]);

  useEffect(() => {
    if (mode !== "coach" || phase !== "present" || !pdfBytes || !coachPdfCanvasRef.current) {
      return;
    }

    let cancelled = false;

    const renderActiveCoachPage = async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const pdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

      if (!coachPdfDocumentRef.current) {
        coachPdfDocumentRef.current = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      }

      const pdf = coachPdfDocumentRef.current;
      const safePage = Math.min(activeSlideIndex + 1, pdf.numPages);
      const page = await pdf.getPage(safePage);
      const canvas = coachPdfCanvasRef.current;
      if (!canvas || cancelled) return;
      const containerWidth = coachPdfViewportRef.current?.clientWidth || canvas.parentElement?.clientWidth || 960;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });
      const context = canvas.getContext("2d");
      const ratio = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      await page.render({ canvasContext: context, viewport }).promise;
    };

    void renderActiveCoachPage();

    return () => {
      cancelled = true;
    };
  }, [activeSlideIndex, mode, pdfBytes, phase]);

  useEffect(() => {
    if (
      phase !== "present" ||
      sessionState !== "active" ||
      !activeSlide ||
      !activeSlideState ||
      activeSlideState.imageOnly ||
      activeSlideState.nonContent ||
      !earliestMissingPoint
    ) {
      return;
    }

    const now = presentationNow;
    const cooledDown = now - lastHintAtRef.current >= ALERT_COOLDOWN_MS;
    const pastIntroGrace = now - slideStartedAtRef.current >= SLIDE_INTRO_GRACE_MS;
    const slideStableLongEnough = now - lastSlideChangeAtRef.current >= ALERT_DELAY_MS;
    const introStillInProgress = !pastIntroGrace && transcriptIdeaCount < MIN_CONTEXT_IDEAS_BEFORE_CUE;
    const hasActiveCue = cueState.cueVisible && !cueState.cueResolved && !cueState.cueDismissed;
    const sameCueTarget = cueState.cueTargetPoint === earliestMissingPoint.id;

    if (
      cooledDown &&
      validCueMoment &&
      !introStillInProgress &&
      slideStableLongEnough &&
      (!hasActiveCue || !sameCueTarget)
    ) {
      setCueState({
        currentCue: cueSourceIcon,
        cueType: "icon",
        cueVisible: true,
        cueTargetPoint: earliestMissingPoint.id,
        cueTriggeredAt: now,
        cueResolved: false,
        cueDismissed: false,
        cueIcon: cueSourceIcon,
        cueKeyword: cueSourceKeyword,
      });
      setCuedPoints((prev) => ({ ...prev, [earliestMissingPoint.id]: true }));
      lastHintAtRef.current = now;
    }
  }, [
    activeSlide,
    activeSlideState,
    coachFeedbackStyle,
    cueSourceIcon,
    cueSourceKeyword,
    cueState,
    earliestMissingPoint,
    mode,
    phase,
    presentationNow,
    sessionState,
    transcriptIdeaCount,
    validCueMoment,
  ]);

  useEffect(() => {
    if (
      mode !== "coach" ||
      phase !== "present" ||
      sessionState !== "active" ||
      coachFeedbackStyle !== "live" ||
      !activeSlide ||
      activeSlide.nonContent ||
      !coachSessionRef.current
    ) {
      return;
    }

    const guidance = buildCoachGuidanceMessage({
      activeSlide,
      checklistPoints,
      metric: coachSessionRef.current.slideMetrics[activeSlideIndex],
      pauseDetected,
      endThoughtDetected,
      validCueMoment,
      speakingNow,
      historyForgottenPoints,
      session: coachSessionRef.current,
      elapsedMs: Date.now() - slideStartedAtRef.current,
    });

    if (!guidance) return;

    const counts = coachSessionRef.current.guidanceCounts || {};
    const nextCount = (counts[guidance.key] || 0) + 1;
    coachSessionRef.current.guidanceCounts = { ...counts, [guidance.key]: nextCount };
    if (Date.now() - (coachSessionRef.current.lastGuidanceAt || 0) < COACH_GUIDANCE_HOLD_MS) return;

    const nextMessage =
      nextCount > 1 && guidance.level === 2 ? guidance.levelTwo || guidance.levelOne : guidance.levelOne;

    if (coachLiveTipRef.current !== nextMessage) {
      coachSessionRef.current.lastGuidanceAt = Date.now();
      coachLiveTipRef.current = nextMessage;
      setCoachLiveTip(nextMessage);
      coachSessionRef.current.missedLiveSuggestions.push(nextMessage);
    }
  }, [
    activeSlide,
    activeSlideIndex,
    checklistPoints,
    coachFeedbackStyle,
    endThoughtDetected,
    historyForgottenPoints,
    mode,
    pauseDetected,
    phase,
    sessionState,
    speakingNow,
    validCueMoment,
  ]);

  useEffect(() => {
    if (
      phase !== "present" ||
      sessionState !== "active" ||
      !cueState.cueVisible ||
      cueState.cueType !== "icon" ||
      !cueState.cueTargetPoint
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const pointStillMissing = !coverage[cueState.cueTargetPoint];
      const stillPaused = Date.now() - lastSpeechActivityAtRef.current >= ACTIVE_SPEECH_HOLD_MS;
      if (!pointStillMissing || !stillPaused) return;
      setCueState((prev) => ({
        ...prev,
        currentCue: prev.cueKeyword || prev.currentCue,
        cueType: "text",
        cueVisible: true,
      }));
    }, mode === "coach" ? COACH_ICON_TO_TEXT_DELAY_MS : ICON_TO_TEXT_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [coverage, cueState, phase, sessionState]);

  useEffect(() => {
    if (
      phase !== "present" ||
      sessionState !== "active" ||
      !activeSlide ||
      activeSlide.imageOnly ||
      activeSlide.nonContent ||
      recentTranscriptText.trim().length < JUDGE_MIN_TEXT_LENGTH
    ) {
      return;
    }

    const missingPoints = activeSlide.points.filter((point) => !coverage[point.id]);
    if (!missingPoints.length) return;

    const signature = `${activeSlide.id}::${recentTranscriptText}::${missingPoints.map((point) => point.id).join(",")}`;
    if (lastJudgeSignatureRef.current === signature) return;
    lastJudgeSignatureRef.current = signature;
    let cancelled = false;

    const judgePoints = async () => {
      try {
        const slideSummary = preparedSlides[activeSlide.id]?.summary || "";
        const scriptContext = scriptGuide[activeSlide.id]?.text || "";

        const results = await Promise.all(
          missingPoints.map(async (point) => {
            const response = await fetch("/api/judge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                point: point.intendedText,
                keyIdeas: [...point.keyIdeas, ...(scriptGuide[activeSlide.id]?.keywords || [])].slice(0, 8),
                slideSummary,
                previousPoint: activeSlide.points[point.pointIndex - 1]?.intendedText || "",
                nextPoint: activeSlide.points[point.pointIndex + 1]?.intendedText || "",
                latestUtterance: lastFinalTranscript,
                recentTranscript: recentTranscriptText,
                fullTranscript: `${spokenCorpus}\n\nScript guide:\n${scriptContext}`.trim(),
              }),
            });

            const payload = await response.json();
            return {
              pointId: point.id,
              ok: response.ok,
              made: Boolean(payload.made),
              confidence: payload.confidence ?? 0,
            };
          })
        );

        if (cancelled) return;

        const newlyCovered = results
          .filter((result) => result.ok && result.made && result.confidence >= 0.45)
          .reduce((accumulator, result) => {
            accumulator[result.pointId] = true;
            return accumulator;
          }, {});

        if (Object.keys(newlyCovered).length) {
          setAiCoveredPoints((prev) => ({ ...prev, ...newlyCovered }));
        }
      } catch {
        lastJudgeSignatureRef.current = "";
      }
    };

    void judgePoints();
    return () => {
      cancelled = true;
    };
  }, [activeSlide, coverage, lastFinalTranscript, phase, preparedSlides, recentTranscriptText, scriptGuide, sessionState, spokenCorpus]);

  useEffect(() => {
    if (!Object.keys(cuedPoints).length) return;
    const remainingCuedPoints = Object.keys(cuedPoints).reduce((accumulator, pointId) => {
      if (!coverage[pointId]) accumulator[pointId] = true;
      return accumulator;
    }, {});

    if (Object.keys(remainingCuedPoints).length !== Object.keys(cuedPoints).length) {
      setCuedPoints(remainingCuedPoints);
    }

    if (cueState.cueTargetPoint && coverage[cueState.cueTargetPoint]) {
      setCueState((prev) => ({ ...prev, cueVisible: false, cueResolved: true, currentCue: "" }));
    }
  }, [coverage, cueState.cueTargetPoint, cuedPoints]);

  useEffect(() => {
    if (
      mode === "coach" ||
      phase !== "present" ||
      sessionState !== "active" ||
      !activeSlideState ||
      activeSlideState.nonContent ||
      !activeSlideState.complete ||
      activeSlideIndex >= slides.length - 1
    ) {
      return;
    }

    const now = presentationNow;
    const notSpeaking = now - lastSpeechActivityAtRef.current >= ACTIVE_SPEECH_HOLD_MS;
    const pausedLongEnough = now - lastSpeechAtRef.current >= AUTO_ADVANCE_PAUSE_MS;
    const slideStableLongEnough = now - lastSlideChangeAtRef.current >= AUTO_ADVANCE_DELAY_MS;
    const autoAdvanceKey = `${activeSlideIndex}:${coveredCount}:${activeSlideState.complete}`;

    if (!notSpeaking || !pausedLongEnough || !slideStableLongEnough || lastAutoAdvanceKeyRef.current === autoAdvanceKey) {
      return;
    }

    lastAutoAdvanceKeyRef.current = autoAdvanceKey;
    const nextIndex = Math.min(activeSlideIndex + 1, slides.length - 1);
    applySlideChange(nextIndex, "Cue moved to the next slide after the current one was covered.");
  }, [activeSlideIndex, activeSlideState, coveredCount, mode, phase, presentationNow, sessionState, slides.length]);

  function showBubble({ text = "", icon = "", tone = "idle" }) {
    window.clearTimeout(bubbleTimerRef.current);
    setHintBubble({ visible: true, text, icon, tone });
    if (tone === "warning" || tone === "success") {
      bubbleTimerRef.current = window.setTimeout(() => {
        setHintBubble((prev) => ({ ...prev, visible: false }));
      }, tone === "warning" ? 3200 : 2400);
    }
  }

  function stopSessionInputs() {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }

  function stopSession() {
    stopSessionInputs();
    setSessionState("idle");
    sessionStateRef.current = "idle";
  }

  function pauseSession() {
    stopSessionInputs();
    setSessionState("paused");
    sessionStateRef.current = "paused";
    setStatusMessage("Rehearsal paused. Resume when you are ready.");
  }

  function resumeSession() {
    setSessionState("active");
    sessionStateRef.current = "active";
    startLiveRecognition();
    setStatusMessage(mode === "coach" ? "Coach Mode is listening again." : "Live presentation mode resumed.");
  }

  function resetRunState(nextPresentation, nextPreparedSlides) {
    setPresentation(nextPresentation);
    setPreparedSlides(nextPreparedSlides);
    setLocalCoveredPoints({});
    setAiCoveredPoints({});
    setCuedPoints({});
    setLastFinalTranscript("");
    setRecentMatchDebug([]);
    setTranscript([]);
    setInterimTranscript("");
    setSpokenCorpus("");
    setActiveSlideIndex(0);
    setManualWarning({ direction: "", armedAt: 0 });
    setHintBubble({ visible: false, text: "", icon: "", tone: "idle" });
    setCueState({
      currentCue: "",
      cueType: "icon",
      cueVisible: false,
      cueTargetPoint: "",
      cueTriggeredAt: 0,
      cueResolved: false,
      cueDismissed: false,
      cueIcon: "",
      cueKeyword: "",
    });
    setCoachLiveTip("");
    coachLiveTipRef.current = "";
    transcriptRef.current = [];
    coverageRef.current = {};
    slidesRef.current = nextPresentation.slides;
    activeSlideIndexRef.current = 0;
    preparedSlidesRef.current = nextPreparedSlides;
    lastSpeechAtRef.current = Date.now();
    lastSpeechActivityAtRef.current = Date.now();
    lastFillerAtRef.current = 0;
    lastThoughtAtRef.current = 0;
    lastHintAtRef.current = 0;
    lastSlideChangeAtRef.current = Date.now();
    slideStartedAtRef.current = Date.now();
    lastAutoAdvanceKeyRef.current = "";
    lastJudgeSignatureRef.current = "";
  }

  function noteCoachChunk(text, matchDebug, newlyCoveredPoints) {
    const session = coachSessionRef.current;
    if (!session || mode !== "coach") return;

    const metric = session.slideMetrics[activeSlideIndexRef.current];
    const now = Date.now();
    const hesitationDetected = now - lastSpeechAtRef.current > 2600 || isFillerMoment(text);
    session.transcript.push(text);
    metric.transcript.push(text);
    metric.spokenWords += countWords(text);
    if (hesitationDetected) metric.hesitationCount += 1;
    if (isEndThoughtMoment(text) && Object.keys(newlyCoveredPoints).length === 0) metric.rushed = true;

    matchDebug.forEach((item) => {
      metric.pointScores[item.pointId] = Math.max(metric.pointScores[item.pointId] || 0, item.score);
    });

    Object.keys(newlyCoveredPoints).forEach((pointId) => {
      if (!metric.coveredPointIds.includes(pointId)) {
        const pointOrder = metric.pointIds.indexOf(pointId);
        const earlierUncovered = metric.pointIds.slice(0, pointOrder).some((id) => !metric.coveredPointIds.includes(id));
        if (earlierUncovered) metric.outOfOrderCount += 1;
        metric.coveredPointIds.push(pointId);
      }
    });

    if (metric.scriptGuide?.keywords?.length) {
      metric.scriptCoverage = Math.max(
        metric.scriptCoverage,
        countKeywordMatches(metric.scriptGuide.keywords, metric.transcript.join(" ")) / metric.scriptGuide.keywords.length
      );
    }
  }

  function addTranscriptChunk(text) {
    const transcriptHistory = transcriptRef.current;
    const currentSlide = slidesRef.current[activeSlideIndexRef.current];
    const recentWindowText = [...transcriptHistory.slice(-2), text].join(" ").trim();
    const currentCoverage = coverageRef.current;
    const currentPreparedSlides = preparedSlidesRef.current;
    const newlyCoveredPoints = {};
    const matchDebug = [];

    if (currentSlide && !currentSlide.imageOnly && !currentSlide.nonContent) {
      currentSlide.points.forEach((point) => {
        if (currentCoverage[point.id]) return;

        const preparedPoint = currentPreparedSlides[currentSlide.id]?.points?.[point.id];
        const scriptKeywords = scriptGuide[currentSlide.id]?.keywords || [];
        const chunkCoverage = computeOrderedPointCoverage(point, text, preparedPoint, scriptKeywords);
        const windowCoverage = recentWindowText
          ? computeOrderedPointCoverage(point, recentWindowText, preparedPoint, scriptKeywords)
          : chunkCoverage;
        const effectiveScore = Math.max(chunkCoverage.score, windowCoverage.score);

        matchDebug.push({
          pointId: point.id,
          label: point.intendedText,
          score: Number(effectiveScore.toFixed(2)),
          covered: chunkCoverage.covered || windowCoverage.covered,
        });

        if (chunkCoverage.covered || windowCoverage.covered) {
          newlyCoveredPoints[point.id] = true;
        }
      });
    }

    setTranscript((prev) => [...prev, text]);
    setInterimTranscript("");
    setSpokenCorpus((prev) => `${prev} ${text}`.trim());
    setLastFinalTranscript(text);
    setRecentMatchDebug(matchDebug.sort((left, right) => right.score - left.score).slice(0, 4));
    if (Object.keys(newlyCoveredPoints).length) {
      setLocalCoveredPoints((prev) => ({ ...prev, ...newlyCoveredPoints }));
    }
    noteCoachChunk(text, matchDebug, newlyCoveredPoints);
    setManualWarning({ direction: "", armedAt: 0 });
    lastSpeechAtRef.current = Date.now();
    lastSpeechActivityAtRef.current = Date.now();
    if (isFillerMoment(text)) lastFillerAtRef.current = Date.now();
    if (isEndThoughtMoment(text)) lastThoughtAtRef.current = Date.now();
  }

  function highlightUploadSection() {
    setUploadPromptVisible(true);
    setUploadHighlight(true);
    window.clearTimeout(uploadHighlightTimerRef.current);
    uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    uploadHighlightTimerRef.current = window.setTimeout(() => {
      setUploadHighlight(false);
    }, 2200);
  }

  function handleLaunchRequest() {
    if (pdfUrl) {
      void startSession();
      return;
    }

    setStatusMessage("Please upload a file first.");
    highlightUploadSection();
  }

  async function prepareSlides(nextPresentation) {
    const fallback = buildLocalPreparation(nextPresentation);
    try {
      const response = await fetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slides: nextPresentation.slides.map((slide) => ({
            slideIndex: slide.slideIndex,
            points: slide.points.map((point) => point.intendedText),
          })),
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Slide preparation failed.");

      return nextPresentation.slides.reduce((accumulator, slide) => {
        const preparedSlide = payload.slides?.find((item) => item.slideIndex === slide.slideIndex);
        accumulator[slide.id] = {
          summary: preparedSlide?.summary || fallback[slide.id].summary,
          points: slide.points.reduce((pointAccumulator, point) => {
            const preparedPoint = preparedSlide?.points?.find((item) => item.pointIndex === point.pointIndex);
            const cue = preparedPoint?.cue || fallback[slide.id].points[point.id].cue;
            const keywords = preparedPoint?.keywords || fallback[slide.id].points[point.id].keywords;
            const mergedPreparedPoint = { cue, keywords };
            pointAccumulator[point.id] = {
              cue,
              keywords,
              icon: chooseHintIcon(point, mergedPreparedPoint),
            };
            return pointAccumulator;
          }, {}),
        };
        return accumulator;
      }, {});
    } catch (error) {
      setStatusMessage(`AI slide prep was unavailable, so Cue fell back to local summaries. ${error.message || ""}`.trim());
      return fallback;
    }
  }

  async function startSession() {
    const nextPresentation = uploadedPresentation || presentation;
    if (!nextPresentation.points.length) {
      setStatusMessage("Please upload a file first.");
      highlightUploadSection();
      return;
    }

    setPreparing(true);
    setStatusMessage(mode === "coach" ? "Preparing Coach Mode..." : "Preparing live presentation mode...");

    const nextPreparedSlides =
      uploadedPresentation === nextPresentation && uploadedPreparedSlides
        ? uploadedPreparedSlides
        : await prepareSlides(nextPresentation);

    setPreparing(false);
    resetRunState(nextPresentation, nextPreparedSlides);
    setPhase("present");
    setSessionState("active");
    sessionStateRef.current = "active";
    setCoachSummary(null);
    setSlideBreakdownVisible(false);

    if (mode === "coach") {
      coachSessionRef.current = createCoachSession(nextPresentation, buildScriptGuide(coachScript, nextPresentation));
      coachSessionRef.current.activeSlideIndex = 0;
      coachSessionRef.current.slideMetrics[0].visitCount += 1;
      coachSessionRef.current.slideMetrics[0].enteredAt = Date.now();
      setStatusMessage("Coach Mode listens while you rehearse. Speak naturally and Cue will track your delivery and guide you.");
    } else {
      coachSessionRef.current = null;
      setStatusMessage("Live presentation mode is active. Cue will stay subtle and only surface a hint when needed.");
    }

    startLiveRecognition();

    if (mode === "live") {
      window.setTimeout(() => {
        void enterFullscreen();
      }, 50);
    }
  }

  function finishSession({ toReview = mode === "coach" } = {}) {
    stopSession();
    setHintBubble({ visible: false, text: "", icon: "", tone: "idle" });
    setCueState((prev) => ({ ...prev, cueVisible: false, currentCue: "" }));

    if (mode === "coach" && coachSessionRef.current) {
      const summary = buildCoachSummary(presentation, coachSessionRef.current, coachHistory, scriptGuide);
      setCoachSummary(summary);
      setCoachHistory((prev) => mergeCoachHistory(prev, summary));
      setStatusMessage("Rehearsal finished. Coach summary is ready.");
      if (toReview) setPhase("review");
      return;
    }

    setStatusMessage("Session stopped. You can adjust the deck and run again.");
  }

  async function goToSetup() {
    stopSession();
    setPhase("setup");
    setHintBubble({ visible: false, text: "", icon: "", tone: "idle" });
    setCueState((prev) => ({ ...prev, cueVisible: false, currentCue: "" }));
    setStatusMessage("Adjust your deck, script, or mode, then start again.");
    await exitFullscreen();
  }

  function restartSession() {
    stopSessionInputs();
    setSessionState("idle");
    sessionStateRef.current = "idle";
    void startSession();
  }

  function startLiveRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSessionState("error");
      sessionStateRef.current = "error";
      setStatusMessage("Speech recognition is not supported here. Use Chrome for live microphone rehearsal.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          finalText += `${event.results[index][0].transcript} `;
        } else {
          interimText += `${event.results[index][0].transcript} `;
        }
      }

      if (interimText.trim()) {
        setInterimTranscript(interimText.trim());
        lastSpeechActivityAtRef.current = Date.now();
      }
      if (finalText.trim()) {
        addTranscriptChunk(finalText.trim());
      }
    };

    recognition.onerror = () => {
      setSessionState("error");
      sessionStateRef.current = "error";
      setStatusMessage("Microphone access failed. Coach Mode needs live microphone access to rehearse.");
    };

    recognition.onend = () => {
      if (sessionStateRef.current === "active") {
        recognition.start();
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
  }

  async function handlePdfUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Please upload a PDF so the presentation stays visually identical.");
      setUploadState("error");
      return;
    }

    setUploadState("loading");
    setUploadError("");
    setUploadPromptVisible(false);
    setUploadHighlight(false);

    try {
      const pdfjsLib = await import("pdfjs-dist");
      const pdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: fileBytes }).promise;
      const objectUrl = URL.createObjectURL(file);
      const pageDescriptors = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await readPdfTextContent(page);
        const lines = extractPageLines(textContent.items);
        pageDescriptors.push(splitSlideTitleAndBody(lines));
      }

      if (pdfUrl) URL.revokeObjectURL(pdfUrl);

      setPdfUrl(objectUrl);
      setPdfName(file.name);
      setPdfPageCount(pdf.numPages);
      setPdfBytes(fileBytes);
      coachPdfDocumentRef.current = pdf;
      setUploadState("success");
      setUploadPromptVisible(false);
      setUploadHighlight(false);

      if (pageDescriptors.length) {
        const nextPresentation = buildPresentationFromPages(pageDescriptors);
        setPreparing(true);
        setStatusMessage(`"${file.name}" uploaded. Preparing slide summaries now...`);
        const nextPreparedSlides = await prepareSlides(nextPresentation);
        setUploadedPresentation(nextPresentation);
        setUploadedPreparedSlides(nextPreparedSlides);
        setPresentation(nextPresentation);
        setPreparedSlides(nextPreparedSlides);
        setPreparing(false);
        setStatusMessage(`${file.name} uploaded and summarized. Cue is ready when you are.`);
      } else {
        setUploadedPresentation(null);
        setUploadedPreparedSlides(null);
        setStatusMessage(`${file.name} uploaded, but no readable slide text was found.`);
      }
    } catch (error) {
      setUploadError(error.message || "PDF upload failed.");
      setUploadState("error");
      setPreparing(false);
      setUploadPromptVisible(true);
    }
  }

  function applySlideChange(nextIndex, message) {
    setActiveSlideIndex(nextIndex);
    setLocalCoveredPoints({});
    setAiCoveredPoints({});
    setCuedPoints({});
    setCueState({
      currentCue: "",
      cueType: "icon",
      cueVisible: false,
      cueTargetPoint: "",
      cueTriggeredAt: 0,
      cueResolved: false,
      cueDismissed: false,
      cueIcon: "",
      cueKeyword: "",
    });
    setLastFinalTranscript("");
    setRecentMatchDebug([]);
    setTranscript([]);
    setSpokenCorpus("");
    transcriptRef.current = [];
    coverageRef.current = {};
    activeSlideIndexRef.current = nextIndex;
    setManualWarning({ direction: "", armedAt: 0 });
    showBubble({ text: message, tone: "warning" });
    setStatusMessage(message);
    lastSpeechActivityAtRef.current = Date.now();
    lastFillerAtRef.current = 0;
    lastThoughtAtRef.current = 0;
    lastHintAtRef.current = Date.now();
    lastSlideChangeAtRef.current = Date.now();
    slideStartedAtRef.current = Date.now();
    lastJudgeSignatureRef.current = "";
    setCoachLiveTip("");
    coachLiveTipRef.current = "";
  }

  function attemptSlideMove(direction) {
    if (!slides.length) return;

    const nextIndex =
      direction === "next"
        ? Math.min(activeSlideIndex + 1, slides.length - 1)
        : Math.max(activeSlideIndex - 1, 0);

    if (nextIndex === activeSlideIndex) return;

    if (mode === "coach") {
      const missingCount = activeSlideState?.pendingPoints.length || 0;
      if (missingCount) {
        const leavingMessage =
          missingCount > 1
            ? `You moved on with ${missingCount} ideas still open on the last slide.`
            : `You moved on before landing ${activeSlideState.pendingPoints[0]?.intendedText || "one idea"}.`;
        setCoachLiveTip(leavingMessage);
        coachLiveTipRef.current = leavingMessage;
      }
      applySlideChange(nextIndex, `Loaded ${getSlideLabel(slides[nextIndex], nextIndex)}.`);
      return;
    }

    const now = Date.now();
    const needsWarning = Boolean(activeSlideState?.pendingPoints.length);
    const warningStillActive =
      manualWarning.direction === direction && now - manualWarning.armedAt <= MANUAL_WARNING_WINDOW_MS;

    if (needsWarning && !warningStillActive) {
      setManualWarning({ direction, armedAt: now });
      showBubble({ text: "Press again", tone: "warning" });
      setStatusMessage("There are still uncovered points on this slide. Press the same button again to override.");
      return;
    }

    applySlideChange(nextIndex, "Manual slide move applied.");
  }

  async function enterFullscreen() {
    const target = presentationRef.current || document.documentElement;
    if (!document.fullscreenElement && target?.requestFullscreen) {
      try {
        await target.requestFullscreen();
      } catch {
        setStatusMessage("Fullscreen was blocked. You can still continue.");
      }
    }
  }

  async function exitFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  }

  const bubbleClass =
    hintBubble.tone === "success"
      ? "bg-emerald-500 text-white"
      : hintBubble.tone === "warning"
        ? "bg-white text-black"
        : "bg-black/75 text-white";

  const startTranscriptDrag = (event) => {
    transcriptDragRef.current = {
      offsetX: event.clientX - transcriptPanelPosition.x,
      offsetY: event.clientY - transcriptPanelPosition.y,
    };
  };

  if (phase === "review" && coachSummary) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7f9fa_34%,#eef3f5_100%)] text-[#333333]">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[30rem] bg-[radial-gradient(circle_at_top,rgba(217,92,92,0.1),transparent_30%),radial-gradient(circle_at_20%_12%,rgba(173,202,232,0.2),transparent_24%)]" />
        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <CoachAvatar size="lg" />
              <div>
                <SectionKicker>Coach Mode</SectionKicker>
                <h1 className="mt-3 font-['Fraunces',serif] text-4xl tracking-[-0.03em] sm:text-5xl">Rehearsal Summary</h1>
                <p className="mt-3 max-w-2xl text-base leading-8 text-[#333333]/72">{coachSummary.overallSummary}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <SetupButton variant="secondary" onClick={goToSetup}>Back to Setup</SetupButton>
              <SetupButton onClick={() => { setPhase("setup"); void startSession(); }}>Restart Rehearsal</SetupButton>
            </div>
          </div>

          <div className="mt-10">
            <SetupCard className="p-7">
              <SectionKicker>Summary</SectionKicker>
              <div className="mt-3 flex items-end justify-between gap-4">
                <h2 className="text-5xl font-semibold">{coachSummary.score}</h2>
                <button
                  onClick={() => setSlideBreakdownVisible((prev) => !prev)}
                  className="rounded-full bg-[#ADCAE8]/28 px-4 py-2 text-sm font-semibold text-[#333333] ring-1 ring-[#ADCAE8]/60"
                >
                  {slideBreakdownVisible ? "Hide Slide Breakdown" : "View Slide Breakdown"}
                </button>
              </div>
              <ul className="mt-5 space-y-2 text-sm leading-7 text-[#333333]/82">
                {coachSummary.conciseBullets.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#D95C5C]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </SetupCard>
            {slideBreakdownVisible ? (
              <SetupCard className="mt-4 p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CoachKicker>Slide-by-Slide Feedback</CoachKicker>
                    <h2 className="mt-2 text-xl font-semibold">Breakdown</h2>
                  </div>
                  <button
                    onClick={() => setSlideBreakdownVisible(false)}
                    className="rounded-full bg-[#FFFFFF] px-3 py-2 text-sm font-semibold text-[#333333] ring-1 ring-[#B0BEC5]/55"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 text-sm leading-7 text-[#333333]/82">
                  {coachSummary.slideBreakdown.map((slide) => (
                    <div key={slide.label} className="mb-5">
                      <p className="font-semibold text-[#333333]">{slide.label}</p>
                      <ul className="mt-2 space-y-1.5">
                        {[
                          slide.coveredCount ? `Covered ${slide.coveredCount} point${slide.coveredCount === 1 ? "" : "s"}.` : "",
                          slide.missingCount ? `Missed ${slide.missingCount} point${slide.missingCount === 1 ? "" : "s"}.` : "",
                          slide.hesitationCount ? `Hesitated ${slide.hesitationCount} time${slide.hesitationCount === 1 ? "" : "s"}.` : "",
                          slide.rushed ? "Rushed the ending." : "",
                        ]
                          .filter(Boolean)
                          .map((item) => (
                            <li key={item} className="flex gap-3">
                              <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#ADCAE8]" />
                              <span>{item}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </SetupCard>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "present" && mode === "coach") {
    return (
      <div ref={presentationRef} className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7f9fa_38%,#eef3f5_100%)] pb-12 text-[#333333]">
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
          <div className="flex flex-col gap-7">
            <SetupCard className="overflow-hidden p-6 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <CoachAvatar size="md" />
                  <div>
                    <CoachKicker>Coach Mode</CoachKicker>
                    <h1 className="mt-1 text-3xl font-semibold">Rehearsal In Progress</h1>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-[#333333]/70">
                      Live microphone rehearsal. Cue listens for meaning, not exact wording, and guides you without interrupting active speech.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {sessionState === "active" ? (
                    <SetupButton variant="secondary" onClick={pauseSession}>Pause Rehearsal</SetupButton>
                  ) : (
                    <SetupButton variant="secondary" onClick={resumeSession}>Resume Rehearsal</SetupButton>
                  )}
                  <SetupButton variant="secondary" onClick={restartSession}>Restart Rehearsal</SetupButton>
                  <SetupButton onClick={() => finishSession({ toReview: true })}>Stop And Review</SetupButton>
                </div>
              </div>
            </SetupCard>

            <div className="grid gap-8 xl:items-start xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.38fr)]">
              <SetupCard className="self-start overflow-hidden p-0">
                <div className="bg-[#E8EFF3] p-1.5 sm:p-2">
                  {pdfUrl ? (
                    <div ref={coachPdfViewportRef} className="relative flex w-full items-center justify-center rounded-[22px] bg-white p-1.5 shadow-[inset_0_0_0_1px_rgba(176,190,197,0.2)] sm:p-2">
                      <canvas ref={coachPdfCanvasRef} className="block h-auto max-w-full shadow-[0_18px_40px_rgba(176,190,197,0.28)]" />
                      {activeCoachCueVisible ? (
                        <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-2">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#333333]/92 text-white shadow-[0_18px_34px_rgba(51,51,51,0.2)] ring-1 ring-white/20">
                            <span className="text-2xl leading-none">{cueState.cueIcon || "C"}</span>
                          </div>
                          <div className="min-w-[7.5rem] max-w-[11rem] rounded-2xl bg-[#D95C5C] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(217,92,92,0.28)] ring-1 ring-[#333333]/8">
                            <div className="flex items-center gap-2">
                              {cueState.cueIcon ? <span className="text-2xl leading-none">{cueState.cueIcon}</span> : null}
                              <span>{coachCueDisplay}</span>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex min-h-[26rem] items-center justify-center rounded-[22px] bg-white px-8 text-center text-[#333333]/66 shadow-[inset_0_0_0_1px_rgba(176,190,197,0.2)]">
                      No PDF uploaded. Upload a PDF if you want the full deck visible while rehearsing.
                    </div>
                  )}
                </div>
              </SetupCard>

              {coachShowsLiveGuidance && slideBreakdownVisible ? (
                <SetupCard className="self-start p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CoachKicker>Slide-by-Slide Feedback</CoachKicker>
                      <h2 className="mt-1 text-xl font-semibold">Breakdown</h2>
                    </div>
                    <button
                      onClick={() => setSlideBreakdownVisible(false)}
                      className="rounded-full bg-[#FFFFFF] px-3 py-2 text-sm font-semibold text-[#333333] ring-1 ring-[#B0BEC5]/55"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-5 max-h-[30rem] overflow-y-auto pr-1 text-sm leading-6 text-[#333333]/80">
                    {liveCoachBreakdown.length ? (
                      liveCoachBreakdown.map((slide) => (
                        <div key={slide.label} className="mb-5">
                          <p className="font-semibold text-[#333333]">{slide.label}</p>
                          <ul className="mt-2 space-y-1.5">
                            {[
                              slide.coveredCount ? `Covered ${slide.coveredCount} point${slide.coveredCount === 1 ? "" : "s"}.` : "",
                              slide.missingCount ? `Missed ${slide.missingCount} point${slide.missingCount === 1 ? "" : "s"}.` : "",
                              slide.hesitationCount ? `Hesitated ${slide.hesitationCount} time${slide.hesitationCount === 1 ? "" : "s"}.` : "",
                              slide.rushed ? "Rushed the ending." : "",
                            ]
                              .filter(Boolean)
                              .slice(0, 3)
                              .map((item) => (
                                <li key={item} className="flex gap-3">
                                  <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#ADCAE8]" />
                                  <span>{item}</span>
                                </li>
                              ))}
                          </ul>
                        </div>
                      ))
                    ) : <p className="text-[#333333]/68">Breakdown will appear here as you rehearse.</p>}
                  </div>
                </SetupCard>
              ) : (
                <SetupCard className="self-start p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <CoachKicker>{coachShowsLiveGuidance ? "Slide Status" : "Slide Navigation"}</CoachKicker>
                      <h2 className="mt-1 text-xl font-semibold leading-8">{currentSlideDisplayLabel}</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-[#ADCAE8]/24 px-3 py-1.5 text-sm font-semibold text-[#333333]">
                        Slide {activeSlideIndex + 1} of {slides.length}
                      </span>
                      {coachShowsLiveGuidance ? (
                        <button
                          onClick={() => setSlideBreakdownVisible((prev) => !prev)}
                          className="rounded-full bg-[#FFFFFF] px-4 py-2 text-sm font-semibold text-[#333333] ring-1 ring-[#B0BEC5]/55"
                        >
                          {slideBreakdownVisible ? "Hide Breakdown" : "Slide Breakdown"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => attemptSlideMove("previous")}
                      disabled={activeSlideIndex === 0}
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#333333] ring-1 ring-[#ADCAE8]/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => attemptSlideMove("next")}
                      disabled={activeSlideIndex === slides.length - 1}
                      className="rounded-full bg-[#ADCAE8] px-4 py-2 text-sm font-semibold text-[#333333] shadow-[0_12px_28px_rgba(173,202,232,0.28)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next →
                    </button>
                  </div>
                  {coachShowsLiveGuidance ? (
                  <div className="mt-4 rounded-[20px] bg-[#FFFFFF] px-4 py-4 ring-1 ring-[#B0BEC5]/50 sm:px-5 sm:py-[1.125rem]">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-[8rem]">
                          <p className="text-xs font-semibold text-[#333333]/52">Status</p>
                          <p className="mt-1 text-lg font-semibold text-[#333333]">{slideStatusLabel}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-6 text-sm text-[#333333]/72">
                          <div>
                            <p className="text-xs font-semibold text-[#333333]/45">Covered</p>
                            <p className="mt-1 font-semibold text-[#333333]">
                              {checklistPoints.filter((point) => point.status === "covered").length}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#333333]/45">Partial</p>
                            <p className="mt-1 font-semibold text-[#333333]">
                              {checklistPoints.filter((point) => point.status === "partial").length}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#333333]/45">Missing</p>
                            <p className="mt-1 font-semibold text-[#333333]">
                              {checklistPoints.filter((point) => point.status === "pending").length}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-[#B0BEC5]/40 pt-4">
                        <p className="text-xs font-semibold text-[#333333]/52">Suggestion</p>
                        <p className="mt-1 text-sm leading-6 text-[#333333]/82">
                          {activeCoachCueVisible
                            ? "Follow the cue on the slide, then keep going naturally."
                            : coachLiveTip || nextSayDisplay}
                        </p>
                        {!activeCoachCueVisible && coachLiveTip && coachLiveTip !== nextSayDisplay ? (
                          <p className="mt-2 text-sm leading-6 text-[#333333]/68">Keep the rest of the slide balanced as you continue.</p>
                        ) : null}
                        {!activeCoachCueVisible && !coachLiveTip && bestRecentMatchLabel ? (
                          <p className="mt-2 text-sm leading-6 text-[#333333]/68">Closest match: {bestRecentMatchLabel}.</p>
                        ) : null}
                      </div>
                      <div className="mt-4 border-t border-[#B0BEC5]/40 pt-4">
                        <p className="text-xs font-semibold text-[#333333]/52">Checklist</p>
                      </div>
                      <div className="mt-3 max-h-40 overflow-y-auto pr-1">
                        <ul className="space-y-2.5 text-sm leading-6 text-[#333333]/72">
                          {checklistPoints.map((point) => (
                            <li key={point.id} className="flex items-center justify-between gap-3">
                              <span>{point.displayLabel}</span>
                              <span className="text-[#333333]">
                                {point.status === "covered" ? "✓" : point.status === "partial" ? "•" : "✗"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-[20px] bg-[#FFFFFF] px-4 py-4 ring-1 ring-[#B0BEC5]/50 sm:px-5 sm:py-[1.125rem]">
                      <div className="grid gap-4 text-sm text-[#333333]/78">
                        <div>
                          <p className="text-xs font-semibold text-[#333333]/52">Current slide</p>
                          <p className="mt-1 leading-6">{currentSlideDisplayLabel}</p>
                        </div>
                        <div className="border-t border-[#B0BEC5]/40 pt-4">
                          <p className="text-xs font-semibold text-[#333333]/52">Rehearsal mode</p>
                          <p className="mt-1 leading-6">Quiet capture now. Cue will save the coaching report for the end.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </SetupCard>
              )}
            </div>

            <div className="grid gap-7 xl:grid-cols-2">
              <SetupCard className="p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CoachKicker>Live Transcript</CoachKicker>
                    <h2 className="mt-1 text-xl font-semibold">What Cue Hears</h2>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${speakingNow ? "bg-[#ADCAE8]/30 text-[#333333]" : "bg-[#FFFFFF] text-[#333333]/66 ring-1 ring-[#B0BEC5]/55"}`}>
                    {speakingNow ? "Mic live" : sessionState === "paused" ? "Paused" : "Waiting"}
                  </span>
                </div>
                <div ref={transcriptScrollRef} className="mt-5 max-h-[22rem] overflow-y-auto pr-2">
                  <div className="rounded-[20px] bg-[#FFFFFF] px-4 py-3 ring-1 ring-[#B0BEC5]/55">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#333333]/45">Live</p>
                    <p className="mt-2 text-sm leading-6 text-[#333333]/72">{interimTranscript || "..."}</p>
                  </div>
                  <div className="mt-3 space-y-3">
                    {(transcriptExpanded ? transcript : transcript.slice(-6)).map((line, index) => (
                      <div key={`${line}-${index}`} className="rounded-[18px] bg-white px-4 py-3 text-sm leading-6 ring-1 ring-[#B0BEC5]/55">
                        {line}
                      </div>
                    ))}
                    {!transcript.length ? (
                      <div className="rounded-[18px] bg-white px-4 py-3 text-sm leading-6 ring-1 ring-[#B0BEC5]/55">
                        No final transcript yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              </SetupCard>

              <SetupCard className="p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CoachKicker>Script Guide</CoachKicker>
                    <h2 className="mt-1 text-xl font-semibold">Optional Reference</h2>
                  </div>
                  <span className="rounded-full bg-[#FFFFFF] px-3 py-1.5 text-sm font-semibold text-[#333333]/66 ring-1 ring-[#B0BEC5]/55">
                    {scriptGuide[activeSlide?.id || ""] ? "Guide active" : "No guide on this slide"}
                  </span>
                </div>
                <div className="mt-5 max-h-72 overflow-y-auto rounded-[22px] bg-[#FFFFFF] px-4 py-3 text-sm leading-6 ring-1 ring-[#B0BEC5]/55">
                  {scriptGuide[activeSlide?.id || ""]?.text ||
                    "Add an optional script on the setup screen and Coach Mode will use it as a flexible guide for intended phrasing and flow."}
                </div>
              </SetupCard>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "present") {
    return (
      <div ref={presentationRef} className="fixed inset-0 z-40 bg-[#111827]">
        {pdfUrl ? (
          <iframe
            key={`pdf-page-${currentPdfPage}`}
            title="Uploaded presentation"
            src={`${pdfUrl}#page=${currentPdfPage}&view=FitH`}
            className="h-full w-full bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[#111827] px-8 text-center text-white/75">
            No PDF uploaded. Upload a PDF if you want the slide deck visible during presentation mode.
          </div>
        )}

        <div className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap gap-3">
          <button onClick={() => attemptSlideMove("previous")} className="rounded-full bg-white/90 px-6 py-3 font-semibold text-[#333333] shadow-lg">
            ← Previous
          </button>
          <button onClick={() => attemptSlideMove("next")} className="rounded-full bg-[#ADCAE8] px-6 py-3 font-semibold text-[#333333] shadow-lg">
            Next →
          </button>
          <button onClick={fullscreenActive ? exitFullscreen : enterFullscreen} className="rounded-full bg-white/90 px-6 py-3 font-semibold text-[#333333] shadow-lg">
            {fullscreenActive ? "Exit Full Screen" : "Full Screen"}
          </button>
          <button onClick={() => finishSession({ toReview: false })} className="rounded-full bg-[#D95C5C] px-6 py-3 font-semibold text-white shadow-lg">
            Stop
          </button>
          <button onClick={goToSetup} className="rounded-full bg-[#333333] px-6 py-3 font-semibold text-white shadow-lg">
            Back to Setup
          </button>
        </div>

        <div className="fixed bottom-5 right-5 z-[70] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
          {hintBubble.visible ? (
            <div className={`rounded-2xl ${bubbleClass} px-4 py-3 text-sm font-semibold shadow-xl`}>
              <div className="flex items-center gap-2">
                {hintBubble.icon ? <span className="text-2xl leading-none">{hintBubble.icon}</span> : null}
                {hintBubble.text ? <span>{hintBubble.text}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col items-end gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/85 text-white shadow-2xl ring-1 ring-white/10">
              <span className="text-xs font-semibold uppercase tracking-[0.2em]">
                {cueState.cueVisible && cueState.cueType === "icon" && cueState.cueIcon ? cueState.cueIcon : cueState.cueVisible ? "Cue" : "C"}
              </span>
            </div>
            {cueState.cueVisible ? (
              <div className="min-w-[8rem] max-w-[16rem] rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black shadow-2xl ring-1 ring-black/10">
                <div className="flex items-center gap-2">
                  {cueState.cueIcon ? <span className="text-2xl leading-none">{cueState.cueIcon}</span> : null}
                  <span>{cueState.cueType === "icon" ? cueState.cueIcon || cueState.currentCue : cueState.cueKeyword || cueState.currentCue}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="fixed z-50 w-[20rem] max-w-[calc(100vw-2rem)] space-y-3" style={{ left: `${transcriptPanelPosition.x}px`, top: `${transcriptPanelPosition.y}px` }}>
          <div className="rounded-2xl bg-black/45 px-4 py-3 text-sm text-white/90 shadow-lg backdrop-blur">
            <div onPointerDown={startTranscriptDrag} className="flex cursor-move items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-2 py-2">
              <span className="font-semibold">Transcript</span>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-xs ${speakingNow ? "bg-emerald-500/80" : "bg-white/15"}`}>
                  {speakingNow ? "Speaking" : "Paused"}
                </span>
                <button onClick={() => setTranscriptExpanded((prev) => !prev)} className="rounded-full bg-white/10 px-2 py-1 text-xs">
                  {transcriptExpanded ? "Compress" : "Expand"}
                </button>
              </div>
            </div>
            <div ref={transcriptScrollRef} className={`mt-3 space-y-2 overflow-y-auto pr-1 ${transcriptExpanded ? "max-h-56" : "max-h-20"}`}>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">Live</p>
                <p className="mt-1 min-h-[1.25rem] text-white/75">{interimTranscript || "..."}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">Final</p>
                <div className="mt-1 space-y-1 text-white">
                  {(transcriptExpanded ? transcript : transcript.slice(-2)).map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
                  {!transcript.length ? <p>No final transcript yet.</p> : null}
                </div>
              </div>
            </div>
          </div>

          {activeSlide?.nonContent ? (
            <div className="rounded-2xl bg-black/45 px-4 py-3 text-sm text-white/90 shadow-lg backdrop-blur">
              <p className="font-semibold">Passive Slide</p>
              <p className="mt-2 text-sm text-white/70">
                This slide is being treated as a title or transition slide. Cue, checklist tracking, and auto-advance are off here.
              </p>
            </div>
          ) : checklistPoints.length ? (
            <div className="rounded-2xl bg-black/45 px-4 py-3 text-sm text-white/90 shadow-lg backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Checklist</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/55">
                    <span>Complete: {slideComplete ? "Yes" : "No"}</span>
                    <span>Speaking: {speakingNow ? "Yes" : "No"}</span>
                    <span>Ready: {autoAdvanceReady ? "Yes" : "No"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60">{activeSlide ? `Slide ${activeSlideIndex + 1}` : ""}</span>
                  <button onClick={() => setChecklistCompact((prev) => !prev)} className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
                    {checklistCompact ? "Expand" : "Compress"}
                  </button>
                </div>
              </div>
              <div className={`mt-3 ${checklistCompact ? "space-y-1.5" : "space-y-2"}`}>
                {checklistPoints.map((point) => (
                  <div
                    key={point.id}
                    title={checklistCompact ? point.label : undefined}
                    className={`flex items-start gap-2 rounded-xl bg-white/5 ${checklistCompact ? "px-2.5 py-1.5" : "px-3 py-2"} ${point.status === "covered" ? "opacity-65" : "opacity-100"}`}
                  >
                    <span className={`${checklistCompact ? "text-sm" : "text-base"} leading-none`}>
                      {point.status === "covered" ? "✅" : point.status === "partial" ? "◔" : point.status === "cued" ? "🔔" : "⭕"}
                    </span>
                    <span className={`min-w-0 flex-1 text-white/90 ${checklistCompact ? "truncate text-xs" : "text-sm"}`}>
                      {point.label}
                    </span>
                  </div>
                ))}
              </div>
              {checklistCompact && compactCompletedCount ? (
                <p className="mt-3 text-[11px] text-white/45">
                  {compactCompletedCount} completed item{compactCompletedCount === 1 ? "" : "s"} faded to keep the panel light.
                </p>
              ) : null}
              {!checklistCompact ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70">
                  <p className="font-semibold text-white/85">{currentSlideLabel}</p>
                  <p className="mt-1">Cue target: {nextCueCandidate || "None"}</p>
                  <p className="mt-1">Covered: {coveredPointLabels.length ? coveredPointLabels.join(" • ") : "None yet"}</p>
                  <p className="mt-1">Missing: {missingPointLabels.length ? missingPointLabels.join(" • ") : "None"}</p>
                  <p className="mt-1">Last final: {lastFinalTranscript || "No final transcript yet"}</p>
                  <p className="mt-1">
                    Best semantic match: {bestRecentMatch ? `${bestRecentMatch.label} (${bestRecentMatch.score})` : "Waiting for speech"}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7f9fa_32%,#eef3f5_100%)] text-[#333333]">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[36rem] bg-[radial-gradient(circle_at_top,rgba(217,92,92,0.12),transparent_34%),radial-gradient(circle_at_20%_12%,rgba(96,125,139,0.12),transparent_28%)]" />
      <div className="relative z-10">
        <header className="sticky top-0 z-30 border-b border-white/60 bg-white/68 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#333333] text-sm font-semibold text-white shadow-[0_10px_30px_rgba(51,51,51,0.16)]">
                C
              </div>
              <div>
                <p className="font-semibold tracking-tight">Cue</p>
                <p className="text-xs uppercase tracking-[0.28em] leading-5 text-[#1F1F1F]">
                  <span className="block">every point,</span>
                  <span className="block">on point.</span>
                </p>
              </div>
            </div>

            <nav className="hidden items-center gap-5 lg:flex">
              <a href="#launch-setup" className="text-sm font-medium text-[#333333]/72 transition hover:text-[#333333]">Launch Setup</a>
              <a href="#how-it-works" className="text-sm font-medium text-[#333333]/72 transition hover:text-[#333333]">How it works</a>
              <a href="#modes" className="text-sm font-medium text-[#333333]/72 transition hover:text-[#333333]">Why Cue</a>
              <a href="#feature-highlights" className="text-sm font-medium text-[#333333]/72 transition hover:text-[#333333]">Feature highlights</a>
              <a href="#contact" className="text-sm font-medium text-[#333333]/72 transition hover:text-[#333333]">Contact</a>
            </nav>

            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-[#ADCAE8]/30 px-3 py-2 text-xs font-medium text-[#333333] sm:inline-flex">
                {mode === "coach" ? "Coach Mode" : "Live Presentation"}
              </span>
              <SetupButton onClick={handleLaunchRequest} disabled={preparing} className="px-5 py-2.5 text-xs sm:text-sm">
                {preparing ? "Preparing..." : mode === "coach" ? "Launch Coach Mode" : "Launch Cue"}
              </SetupButton>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-8 lg:px-10 lg:pt-12">
          <section className="mx-auto flex max-w-5xl flex-col items-center text-center">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-3 rounded-full border border-[#ADCAE8]/60 bg-white/90 px-4 py-2 text-sm text-[#333333] shadow-[0_14px_40px_rgba(173,202,232,0.18)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#D95C5C]" />
                Presentation support with rehearsal intelligence
              </div>
              <h1 className="mx-auto mt-6 max-w-[14ch] font-['Fraunces',serif] text-5xl leading-[0.96] tracking-[-0.04em] text-[#333333] sm:text-6xl lg:text-7xl">
                <span className="block">every point,</span>
                <span className="block">on point.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#333333]/72 sm:text-xl">
                Cue listens quietly when you present and coaches intelligently when you rehearse, helping every important point land with more confidence.
              </p>

              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <SetupButton onClick={handleLaunchRequest} disabled={preparing}>
                  {preparing ? "Preparing your deck..." : mode === "coach" ? "Start Coach Mode" : "Start presentation mode"}
                </SetupButton>
                <SetupButton variant="secondary" onClick={() => setMode((prev) => (prev === "live" ? "coach" : "live"))}>
                  Switch to {mode === "live" ? "Coach Mode" : "Live Presentation"}
                </SetupButton>
              </div>

              <div className="mt-14 grid gap-4 sm:grid-cols-2">
                <SetupCard className="p-5">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-[#1F1F1F]">Live Presentation</p>
                  <p className="mt-3 text-lg font-semibold">Quiet support while the room is watching.</p>
                  <p className="mt-2 text-sm leading-7 text-[#333333]/72">
                    Real-time listening, slide-aware tracking, and subtle cueing that waits for natural pauses.
                  </p>
                </SetupCard>
                <SetupCard className="p-5">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-[#1F1F1F]">Coach Mode</p>
                  <p className="mt-3 text-lg font-semibold">A smarter rehearsal coach for stronger runs.</p>
                  <p className="mt-2 text-sm leading-7 text-[#333333]/72">
                    Track missed points, repeated mistakes, script alignment, pacing, and the ideas you skip most often.
                  </p>
                </SetupCard>
              </div>
            </div>
          </section>

          <section id="launch-setup" className="mt-14">
            <SetupCard className="overflow-hidden p-6 sm:p-8">
              <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
                <div>
                  <SectionKicker>Launch Setup</SectionKicker>
                  <h2 className="mt-4 font-['Fraunces',serif] text-3xl leading-tight tracking-[-0.03em] sm:text-4xl">
                    Prepare Cue in a minute, then rehearse or present with clarity.
                  </h2>
                  <p className="mt-4 max-w-xl text-base leading-8 text-[#333333]/72">
                    Upload your deck, decide whether you want quiet live support or a richer coaching workflow, and optionally add a script so Coach Mode can learn your intended flow.
                  </p>
                  <div className="mt-6 grid gap-4">
                    {mode === "coach" ? (
                      <div className="rounded-[24px] bg-[#F6F8F9] p-5 ring-1 ring-[#ADCAE8]/50">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <CoachAvatar size="sm" />
                            <div>
                              <p className="text-sm font-semibold">Optional Script Guide</p>
                              <p className="text-sm text-[#333333]/65">Paste notes or a script. Cue will treat paragraph breaks as flow cues, not strict wording requirements.</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setScriptExpanded((prev) => !prev)}
                            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#333333] ring-1 ring-[#ADCAE8]/45"
                          >
                            {scriptExpanded ? "Collapse" : "Expand"}
                          </button>
                        </div>

                        {scriptExpanded ? (
                          <div className="mt-4 space-y-4">
                            <textarea
                              value={coachScript}
                              onChange={(event) => setCoachScript(event.target.value)}
                              placeholder="Paste speaking notes, a rough script, or the message you want to land. Separate ideas with paragraph breaks and Cue will use them as slide or section guidance."
                              className="min-h-[10rem] w-full rounded-[20px] border border-[#ADCAE8]/55 bg-white px-4 py-4 text-sm text-[#333333] outline-none"
                            />
                            <div className="flex flex-wrap items-center gap-3">
                              {coachScript.trim() ? (
                                <span className="rounded-full bg-[#ADCAE8]/24 px-3 py-1.5 text-xs font-semibold text-[#333333]">
                                  Guide active
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3">
                      <SetupButton onClick={handleLaunchRequest} disabled={preparing}>
                        {preparing ? "Preparing..." : mode === "coach" ? "Start Coach Mode" : "Start with Cue"}
                      </SetupButton>
                      <div className="rounded-full bg-[#ADCAE8]/35 px-4 py-2 text-sm text-[#333333]">{statusMessage}</div>
                    </div>
                  </div>
                </div>

                <div className="grid content-start gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <button
                      onClick={() => setMode("live")}
                      className={`rounded-[24px] p-5 text-left transition duration-300 ${
                        mode === "live"
                          ? "bg-[#333333] text-white shadow-[0_18px_60px_rgba(51,51,51,0.18)]"
                          : "bg-[#F6F8F9] text-[#333333] ring-1 ring-[#ADCAE8]/50 hover:bg-white"
                      }`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.24em] text-[#D95C5C]">Mode One</p>
                      <p className="mt-3 text-xl font-semibold">Live Presentation</p>
                      <p className="mt-2 text-sm leading-6 opacity-80">Cue listens live and only nudges when needed.</p>
                    </button>
                    <button
                      onClick={() => setMode("coach")}
                      className={`rounded-[24px] p-5 text-left transition duration-300 ${
                        mode === "coach"
                          ? "bg-[#ADCAE8] text-[#333333] shadow-[0_18px_60px_rgba(173,202,232,0.28)]"
                          : "bg-[#F6F8F9] text-[#333333] ring-1 ring-[#ADCAE8]/50 hover:bg-white"
                      }`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.24em] text-[#D95C5C]">Mode Two</p>
                      <p className="mt-3 text-xl font-semibold">Coach Mode</p>
                      <p className="mt-2 text-sm leading-6 opacity-80">Practice with feedback, memory, and post-run review.</p>
                    </button>
                  </div>

                  {mode === "coach" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <button
                        onClick={() => setCoachFeedbackStyle("live")}
                        className={`rounded-[22px] p-4 text-left transition ${
                          coachFeedbackStyle === "live"
                            ? "bg-white ring-2 ring-[#ADCAE8]"
                            : "bg-[#F6F8F9] ring-1 ring-[#ADCAE8]/45"
                        }`}
                      >
                        <p className="text-sm font-semibold">Live Guidance</p>
                        <p className="mt-1 text-sm text-[#333333]/65">Small suggestions during rehearsal, with minimal interruption.</p>
                      </button>
                      <button
                        onClick={() => setCoachFeedbackStyle("summary")}
                        className={`rounded-[22px] p-4 text-left transition ${
                          coachFeedbackStyle === "summary"
                            ? "bg-white ring-2 ring-[#ADCAE8]"
                            : "bg-[#F6F8F9] ring-1 ring-[#ADCAE8]/45"
                        }`}
                      >
                        <p className="text-sm font-semibold">End Summary</p>
                        <p className="mt-1 text-sm text-[#333333]/65">Keep rehearsal quiet now and get fuller feedback afterward.</p>
                      </button>
                    </div>
                  ) : null}

                  <div
                    ref={uploadSectionRef}
                    className={`rounded-[24px] bg-[#F6F8F9] p-5 transition duration-500 ${
                      uploadHighlight ? "ring-2 ring-[#D95C5C] shadow-[0_0_0_10px_rgba(217,92,92,0.08)]" : "ring-1 ring-[#ADCAE8]/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <label className="text-sm font-semibold text-[#333333]">Upload your deck</label>
                      {uploadPromptVisible ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-[#D95C5C]/10 px-3 py-1.5 text-xs font-semibold text-[#D95C5C]">
                          <span className="text-sm leading-none">!</span>
                          Required
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#333333]/72">
                      Cue reads each slide, identifies content slides, and prepares the experience before you begin.
                    </p>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handlePdfUpload}
                      className="mt-4 block w-full rounded-[20px] border border-dashed border-[#ADCAE8]/70 bg-white px-4 py-5 text-sm text-[#333333]"
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                      <span className="rounded-full bg-white px-3 py-1.5 text-[#333333] ring-1 ring-[#ADCAE8]/55">
                        {uploadState === "loading"
                          ? "Reading PDF..."
                          : uploadState === "success"
                            ? `${pdfName} · ${pdfPageCount} pages`
                            : pdfName}
                      </span>
                      {uploadError ? <span className="text-[#D95C5C]">{uploadError}</span> : null}
                    </div>
                    {uploadPromptVisible ? (
                      <p className="mt-4 text-sm font-medium text-[#D95C5C]">Please upload a file first.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </SetupCard>
          </section>

          {mode === "coach" ? (
            <section className="mt-16">
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <SetupCard className="p-7">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <SectionKicker>Coach Memory</SectionKicker>
                      <h2 className="mt-3 text-2xl font-semibold">Most Forgotten Points</h2>
                    </div>
                    <CoachAvatar size="sm" />
                  </div>
                  <div className="mt-5 space-y-3">
                    {historyForgottenPoints.map((point, index) => (
                      <div key={`${point.label}-${index}`} className="flex items-center justify-between rounded-[20px] bg-[#F6F8F9] px-4 py-4 ring-1 ring-[#ADCAE8]/45">
                        <div className="flex items-center gap-4">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#333333] text-sm font-semibold text-white">{index + 1}</span>
                          <div>
                            <p className="font-semibold">{point.label}</p>
                            <p className="text-sm text-[#333333]/60">{point.slideLabel}</p>
                          </div>
                        </div>
                        <span className="rounded-full bg-[#D95C5C]/10 px-3 py-1.5 text-xs font-semibold text-[#D95C5C]">
                          {point.missed} misses
                        </span>
                      </div>
                    ))}
                    {!historyForgottenPoints.length ? (
                      <div className="rounded-[20px] bg-[#F6F8F9] px-4 py-4 text-sm leading-7 ring-1 ring-[#ADCAE8]/45">
                        No rehearsal memory yet. Finish a few Coach Mode runs and Cue will rank the points you miss most often.
                      </div>
                    ) : null}
                  </div>
                </SetupCard>

                <SetupCard className="p-7">
                  <SectionKicker>Rehearsal Insights</SectionKicker>
                  <h2 className="mt-3 text-2xl font-semibold">Patterns Over Time</h2>
                  <div className="mt-5 space-y-3">
                    {historyInsights.map((insight) => (
                      <div key={insight} className="rounded-[20px] bg-[#ADCAE8]/18 px-4 py-4 text-sm leading-7 ring-1 ring-[#ADCAE8]/55">
                        {insight}
                      </div>
                    ))}
                    {!historyInsights.length ? (
                      <div className="rounded-[20px] bg-[#ADCAE8]/18 px-4 py-4 text-sm leading-7 ring-1 ring-[#ADCAE8]/55">
                        Coach Mode will track skipped points, rushed slides, weak transitions, and hesitation hotspots as you keep rehearsing.
                      </div>
                    ) : null}
                  </div>
                </SetupCard>
              </div>
            </section>
          ) : null}

          <section id="how-it-works" className="mt-24">
            <div className="max-w-2xl">
              <SectionKicker>How it works</SectionKicker>
              <h2 className="mt-4 font-['Fraunces',serif] text-4xl tracking-[-0.03em] text-[#333333] sm:text-5xl">
                Presentation support that becomes rehearsal intelligence.
              </h2>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {marketingSteps.map((step) => (
                <SetupCard key={step.title} className="p-6 sm:p-7">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-[#D95C5C]">{step.eyebrow}</p>
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-[#333333]/72">{step.description}</p>
                </SetupCard>
              ))}
            </div>
          </section>

          <section id="modes" className="mt-24">
            <div className="grid gap-6 lg:grid-cols-2">
              {modeCards.map((card, index) => (
                <div
                  key={card.title}
                  className={`overflow-hidden rounded-[34px] p-8 shadow-[0_24px_90px_rgba(96,125,139,0.12)] ${
                    index === 0 ? "bg-[linear-gradient(180deg,#ffffff_0%,#eef6fb_100%)] ring-1 ring-[#ADCAE8]/55" : "bg-[linear-gradient(180deg,#ADCAE8_0%,#7F9CB8_100%)] text-[#333333]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.24em] ${
                      index === 0 ? "bg-[#D95C5C]/10 text-[#D95C5C]" : "bg-white/45 text-[#333333]/75"
                    }`}>
                      {card.label}
                    </span>
                    <span className={`h-3 w-3 rounded-full ${index === 0 ? "bg-[#D95C5C]" : "bg-white/70"}`} />
                  </div>
                  <h3 className="mt-6 text-3xl font-semibold tracking-tight">{card.title}</h3>
                  <p className={`mt-4 text-base leading-8 ${index === 0 ? "text-[#333333]/72" : "text-[#333333]/78"}`}>
                    {card.description}
                  </p>
                  <div className="mt-8 space-y-3">
                    {card.points.map((point) => (
                      <div key={point} className={`rounded-[20px] px-4 py-3 text-sm ${index === 0 ? "bg-white text-[#333333] ring-1 ring-[#ADCAE8]/50" : "bg-white/45 text-[#333333]"}`}>
                        {point}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="feature-highlights" className="mt-24 grid gap-12 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <SectionKicker>Feature Highlights</SectionKicker>
              <h2 className="mt-4 font-['Fraunces',serif] text-4xl tracking-[-0.03em] text-[#333333] sm:text-5xl">
                Built to feel intelligent, polished, and encouraging.
              </h2>
              <p className="mt-5 text-base leading-8 text-[#333333]/72">
                Cue helps the presenter recover smoothly, understand what they miss, and improve across rehearsals without feeling robotic or harsh.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {marketingFeatures.map((feature) => (
                <SetupCard key={feature} className="p-5 ring-1 ring-[#D95C5C]/28">
                  <p className="text-base leading-7 text-[#333333]">{feature}</p>
                </SetupCard>
              ))}
            </div>
          </section>

          <footer id="contact" className="mt-24 border-t border-[#B0BEC5]/35 pt-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold tracking-tight">Cue</p>
                <p className="mt-2 text-sm leading-6 text-[#333333]/68">
                  every point,<br />
                  on point.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-[#333333]/78 sm:text-right">
                <a href="mailto:hala@cue.ae" className="transition hover:text-[#333333]">hala@cue.ae</a>
                <a href="mailto:nada@cue.ae" className="transition hover:text-[#333333]">nada@cue.ae</a>
                <a href="mailto:zainah@cue.ae" className="transition hover:text-[#333333]">zainah@cue.ae</a>
                <a href="mailto:sara@cue.ae" className="transition hover:text-[#333333]">sara@cue.ae</a>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
