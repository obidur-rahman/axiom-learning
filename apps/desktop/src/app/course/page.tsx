import type { Metadata } from 'next';
import { CourseScreen } from '../../components/course-screen';

export const metadata: Metadata = { title: 'Course - Axiom Learning' };

export default function CoursePage() {
  return <CourseScreen />;
}
