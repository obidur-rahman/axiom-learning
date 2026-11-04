/**
 * Home: the course list inside the floating-rail shell.
 */
import { AppShell } from '../components/app-shell';
import { CourseList } from '../components/course-list';

export default function Home() {
  return (
    <AppShell>
      <CourseList />
    </AppShell>
  );
}
