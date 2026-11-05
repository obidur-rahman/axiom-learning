'use client';

/**
 * Text-to-speech for lessons and tutor answers, using the browser's built-in
 * speech engine (WebView2 on Windows). Nothing is sent to a server: the voice
 * comes from the operating system.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPrefs } from './prefs';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Markdown and LaTeX read out loud are noise: keep the prose only. */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' Code example. ')
    .replace(/~~~[\s\S]*?~~~/g, ' Code example. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' An equation. ')
    .replace(/\$[^$\n]*\$/g, ' math ')
    .replace(/\\\([\s\S]*?\\\)/g, ' math ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' An equation. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|_{2,}/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const language = loadPrefs().language;
  const wanted = language === 'bn' ? 'bn' : 'en';
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(wanted));
  const pool = matching.length > 0 ? matching : voices;
  const preferred = pool.find((voice) =>
    /natural|neural|google|samantha|aria|jenny|guy|zira/i.test(voice.name),
  );
  return preferred ?? pool.find((voice) => voice.localService) ?? pool[0] ?? null;
}

export interface SpeakOptions {
  onEnd?: () => void;
  /** Narration is a little slower than normal speech. */
  rate?: number;
}

/** Speak a block of text, replacing whatever was playing. */
export function speakText(text: string, options: SpeakOptions = {}): void {
  if (!speechSupported()) {
    options.onEnd?.();
    return;
  }
  const cleaned = text.trim();
  if (cleaned === '') {
    options.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleaned);
  const voice = pickVoice(window.speechSynthesis.getVoices());
  if (voice !== null) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = options.rate ?? 0.98;
  utterance.pitch = 1;
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** React binding around the engine: one utterance at a time, per component. */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setSupported(speechSupported());
    if (speechSupported() && window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      mounted.current = false;
      stopSpeaking();
    };
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    speakText(text, {
      onEnd: () => {
        if (mounted.current) setSpeaking(false);
        onEnd?.();
      },
    });
    if (mounted.current) setSpeaking(true);
  }, []);

  const stop = useCallback(() => {
    stopSpeaking();
    if (mounted.current) setSpeaking(false);
  }, []);

  return { speaking, supported, speak, stop };
}
