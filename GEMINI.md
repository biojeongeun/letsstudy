# 프로젝트 지침 (letsstudy - 오후 자습 출석 & 감독 확인 시스템)

## 프로젝트 고유 식별 정보 (비밀값 없음)
- **작업 폴더**: `c:\Users\User\OneDrive\문서\letsstudy`
- **GitHub 저장소 URL**: `https://github.com/biojeongeun/letsstudy`
- **Supabase Organization ID**: `melsszvcilupsqhklddk` (`biojeongeun`)
- **Supabase Project Ref**: `vzungexqzhxamryfzzwz` (`letsstudy`, `ap-northeast-2`)
- **Vercel Org ID (Team)**: `team_QQ79b2o6FdvQs6Y9hLjkExOH` (`jeong-eun1`)
- **Vercel Project ID**: `prj_ZIV7VDw1pyrGQLcg0X5gaj4jT30q` (`letsstudy`)

## 보안 및 운영 원칙
- `.env.local`, `.vercel`, `.supabase`, 인증 파일, 비밀값, 학생 실명 개인정보는 절대 Git에 커밋하지 않는다.
- 모든 테이블(`classrooms`, `students`, `absence_reasons`, `attendance_records`, `supervisor_confirmations`)은 RLS가 활성화되어 있으며 비로그인·타인 접근을 차단하고 교사(관리자)와 오후 자습 감독관의 권한을 분리한다.
