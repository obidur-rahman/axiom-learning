'use client';

/**
 * A generated animation for one lesson beat. It runs in a sandboxed iframe:
 * `allow-scripts` without `allow-same-origin` means the generated page cannot
 * read this window, the database or the learner's storage, and it cannot
 * navigate the app. Code comes from the model, so that boundary is the point.
 */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { LessonAnimation as LessonAnimationData } from '@axiom/data';

export function LessonAnimation({
  animation,
  large = false,
}: {
  animation: LessonAnimationData;
  large?: boolean;
}) {
  const [generation, setGeneration] = useState(0);

  return (
    <figure className={`lesson-animation${large ? ' lesson-animation-lg' : ''}`}>
      <iframe
        // A new key mounts a fresh document, which replays from frame one.
        key={generation}
        title={animation.title}
        srcDoc={animation.html}
        sandbox="allow-scripts"
        loading="lazy"
        className="lesson-animation-frame"
      />
      <figcaption className="lesson-animation-caption">
        <span className="lesson-animation-title">{animation.title}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setGeneration((value) => value + 1)}
          title="Play this animation again from the start"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Replay
        </button>
      </figcaption>
    </figure>
  );
}
