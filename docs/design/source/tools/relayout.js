// Lays out every board on the canvas by flow section. Titles come from each board's <title>.
const fs=require('fs'),path=require('path');
const proj=path.join(__dirname,'..','..','frames');
const cp=path.join(proj,'canvas.json');
const c=JSON.parse(fs.readFileSync(cp,'utf8'));
const S=[
 ['t-auth','1 · الدخول — جوجل أو Apple أو البريد وكلمة المرور (ADR 0012)',['Welcome','EmailSignIn','EmailSignInError','EmailSignUp','Otp','ForgotPassword','ResetPassword','SignInConflict'],['s-source']],
 ['t-onboard','2 · الانضمام بعد الدخول — الدور، البيانات، المنطقة الزمنية، الشروط، تأكيد الجنس، الإشعارات',['Role','OnboardProfile','TimeZonePicker','Terms','ConfirmGender','ConfirmGenderTeacher','NotificationPermission','StudentHomeEmpty'],[]],
 ['t-apply','3 · طلب المعلم — المواد، الهوية، الإجازات، المتابعة، القرار',['ApplySubjects','ApplyDocuments','ApplyIjazah','ApplicationStatus','ApplicationMoreInfo','ApplicationRejected','ApplicationApproved'],['s-onboard']],
 ['t-stud1','4 · الطالب — الرئيسية والاستكشاف والحجز',['Main','MainOffline','Discovery','DiscoveryFilter','DiscoveryFiltered','DiscoverySearch','DiscoveryEmpty','DiscoverySearchEmpty','DiscoveryNoTeachers','TeacherProfile','TeacherProfileReviews','TeacherProfileReviewsEmpty','ReportSheet','BookingSheet','SlotTaken','Checkout','CheckoutExpired','CheckoutPrevious'],[]],
 ['t-pay','5 · الطالب — نتيجة الدفع',['Processing','ProcessingDelayed','PaymentSuccess','PaymentFailed','PaymentSlotUnavailable'],['s-flow','s-failed']],
 ['t-stud2','6 · الطالب — الاشتراكات والجلسات والإلغاء والنزاع والتقييم',['Enrollments','EnrollmentsEnded','EnrollmentsEmpty','EnrollmentsEndedEmpty','EnrollmentDetail','SessionStates','CancelRequestSheet','CancelSessionPicker','CancelRespondSheet','MakeupChoiceSheet','MakeupProposalSheet','RaiseDispute','EnrollmentTerminated','WriteReview'],['s-cancel']],
 ['t-cert','7 · الإجازات — الشهادة، الإلغاء، صفحة التحقق العامة',['Credentials','CredentialsEmpty','CertificateNameSheet','CertificateView','CertificateRevoked','VerifyCertificate','VerifyCertificateRevoked','VerifyCertificateNotFound'],['s-ijazah']],
 ['t-account','8 · الحساب — الإعدادات، الخروج، الحذف، الحساب المقيّد',['StudentAccount','StudentProfileEditor','TeacherAccount','SignOutSheet','DeleteAccount','DeleteAccountSheet','DeleteAccountWeb','DeleteAccountWebCode','DeleteAccountWebDone','DeleteAccountTeacher','DeleteAccountTeacherSheet','AccountRestricted','TeacherRestricted','VerifyIdentity'],['s-decide']],
 ['t-tsetup','9 · المعلم — بعد القبول: حساب الاستلام، الملف، التوقيع، الإجازات، الباقات، المواعيد',['PayoutStart','PayoutSetup','PayoutVerified','PayoutRejected','ProfileEditor','SignatureUpload','SignatureUploadEmpty','TeacherCredentials','CredentialNeedsDocument','AddSubject','Packages','PackagesLocked','PackagesEmpty','PackageEditor','PackageDeactivateSheet','PackageSubjectPicker','SubjectPicker','Availability','AvailabilityEmpty','SlotEditor','SlotDisableSheet'],['s-money']],
 ['t-teach','10 · المعلم — اليوم، الطلاب، طلب الإجازة، التقييمات، الإشعارات',['TeacherHome','TeacherHomeEmpty','TeacherStudents','TeacherStudentsEnded','TeacherStudentsEmpty','TeacherEnrollment','TeacherEnrollmentIjazah','TeacherEnrollmentCompleted','TeacherCancelRequest','TeacherCancelSessionPicker','TeacherCancelRespond','TeacherMakeupRespond','TeacherReportSheet','IjazahRequest','IjazahRequestPreview','IjazahRequestSent','IjazahRequestBlocked','TeacherReviews','TeacherReviewsEmpty','TeacherNotifications'],[]],
 ['t-shared','11 · الجلسة والمحادثة والإشعارات — مشترك بين الدورين',['PreSession','TeacherPreSession','PreSessionPermission','SessionWaiting','SessionRoom','SessionReconnecting','SessionEnded','Chat','ChatEmpty','Notifications','NotificationsEmpty'],['s-session']],
 ['t-system','12 · نظام التصميم — نموذج إنجليزي ونموذج داكن، شريطا التبويب، المرجع (tokens)، المكوّنات',['MainEn','MainDark','StudentTabs','TeacherTabs','DesignLanguage','Components'],['s-system']],
];
const ADMIN=['AdminSignIn','AdminSignInError','AdminMfa','AdminMfaRecovery','AdminMfaSetup','AdminHome','AdminHomeEn','AdminApplications','AdminApplicationsEn','AdminDecisionDialog','AdminDecisionDialogInfo','AdminDocumentViewer','AdminCredentials','AdminCredentialCorrect','AdminUsers','AdminUsersFilter','AdminTeacher','AdminSuspendDialog','AdminSuspendDialogRevoke','AdminSuspendStudentDialog','AdminSuspendStudentDialogBan','AdminRequireIdDialog','AdminEnrollments','AdminPayments','AdminDisputes','AdminCompensation','AdminChatLog','AdminSessionReview','AdminGender','AdminReports','AdminReviews','AdminIjazahRequests','AdminConfirmDialog','AdminConfirmDialogIssue','AdminIjazahs','AdminRevokeDialog','AdminSettings','AdminAdmins','AdminAddAdminDialog','AdminMfaResetDialog','AdminAudit','AdminQueueEmpty','AdminLoadError'];
const title=n=>{const s=fs.readFileSync(path.join(proj,n+'.dc.html'),'utf8');return (s.match(/<title>([^<]*)<\/title>/)||[,n])[1];};
const exists=n=>fs.existsSync(path.join(proj,n+'.dc.html'));
const boards={},order=[],notes={},missing=[];
const keep=c.notes;
let y=0;
for(const [tid,t,list,side] of S){
  notes[tid]={x:0,y:y-260,text:t,kind:'title1',maxW:4000};
  let x=0,rowH=844;
  for(const n of list){ if(!exists(n)){missing.push(n);continue;}
    const old=c.boards[n+'.dc.html']||{};const w=old.w||390,h=old.h||844;
    boards[n+'.dc.html']={x,y,w,h,title:title(n),is_interactive:true,radius:w===390?32:12};
    order.push(n+'.dc.html'); x+=w+80; rowH=Math.max(rowH,h); }
  for(const s of side){ if(keep[s]) notes[s]={...keep[s],x,y}; else notes[s]={x,y,w:360,text:'',fill:'green'}; x+=440; }
  y+=rowH+356;
}
notes['t-admin']={x:0,y:y-260,text:'13 · لوحة الإدارة (ويب) — بنفس نظام التصميم، بالعربية والإنجليزية (ADR 0014)',kind:'title1',maxW:6200};
ADMIN.forEach((n,i)=>{ if(!exists(n)){missing.push(n);return;}
  boards[n+'.dc.html']={x:(i%4)*1560,y:y+Math.floor(i/4)*1100,w:1440,h:900,title:title(n),is_interactive:true,radius:12};
  order.push(n+'.dc.html'); });
notes['s-admin']={...(keep['s-admin']||{w:360,text:'',fill:'green'}),x:4*1560,y};
const extra=Object.keys(c.boards).filter(k=>!boards[k]);
c.boards=boards;c.order=order;
// Keep note texts written elsewhere; the empty ones get text from notes.json.
const nt=JSON.parse(fs.readFileSync(path.join(__dirname,'notes.json'),'utf8'));
for(const [k,v] of Object.entries(notes)) if(nt[k]) v.text=nt[k];
c.notes=notes;
fs.writeFileSync(cp,JSON.stringify(c,null,1)+'\n');
console.log('boards',order.length,'missing',missing.join(' ')||'-','dropped',extra.join(' ')||'-');
