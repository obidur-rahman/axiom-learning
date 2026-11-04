import type { Metadata } from 'next';
import { AppShell } from '../../components/app-shell';
import { CourseScreen } from '../../components/course-screen';

export const metadata: Metadata = { title: 'Course - Axiom Learning' };

export default function CoursePage() {
  return (
    <AppShell>
      <CourseScreen />
    </AppShell>
  );
}
