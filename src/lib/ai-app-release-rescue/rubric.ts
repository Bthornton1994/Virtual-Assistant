import { RUBRIC_CATEGORIES, RUBRIC_CATEGORY_COPY, type RubricCategory } from "@/lib/ai-app-release-rescue/constants";

export function allRubricCategories(): RubricCategory[] {
  return [...RUBRIC_CATEGORIES];
}

export function missingRubricCategories(scored: Iterable<string>): RubricCategory[] {
  const present = new Set(scored);
  return RUBRIC_CATEGORIES.filter((category) => !present.has(category));
}

export function rubricTitle(category: RubricCategory) {
  return RUBRIC_CATEGORY_COPY[category].title;
}

export function rubricExamines(category: RubricCategory) {
  return RUBRIC_CATEGORY_COPY[category].examines;
}
