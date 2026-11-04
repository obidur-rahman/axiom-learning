import type { Metadata } from 'next';
import { AppShell } from '../../components/app-shell';
import { CourseLibrary } from '../../components/course-library';

export const metadata: Metadata = { title: 'Courses - Axiom Learning' };

export default function CoursesPage() {
  return (
    <AppShell>
      <CourseLibrary />
    </AppShell>
  );
}
