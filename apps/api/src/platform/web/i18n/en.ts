// GENERATED from apps/mobile/src/i18n/en.json by scripts/build-web-copy.ts. Do not edit; run `pnpm web-copy:build`.
export const en = {
  web: {
    deleteAccount: {
      brandDone: 'Ijazah · Account deletion',
      brandMark: 'I',
      brandName: 'Ijazah',
      brandSuffix: '· Account deletion',
      code: {
        a11y: {
          digit1: 'First digit',
          digit2: 'Second digit',
          digit3: 'Third digit',
          digit4: 'Fourth digit',
          digit5: 'Fifth digit',
          digit6: 'Sixth digit',
        },
        changeEmail: 'Change email',
        irreversible: 'Deletion cannot be undone and the account cannot be restored.',
        label: 'Code',
        lede: 'We sent a 6-digit code to {email}',
        submit: 'Delete the account permanently',
        title: 'Enter the code',
      },
      codeInvalid: 'The code is wrong or has expired.',
      done: {
        confirmation:
          'A deletion confirmation was sent to {email}. For questions, write to {supportEmail}.',
        ijazahs: 'Your ijazahs stay valid on the verification page by their number.',
        lede: 'Your personal data has been deleted and your upcoming sessions cancelled, and the account cannot be restored.',
        newAccount: 'You can create a new account with the same email at any time.',
        records: 'Payment and session records are kept without your data, as the law requires.',
        title: 'Your account has been deleted',
      },
      email: 'Account email address',
      emailInvalid: 'Enter a valid email address.',
      honest: {
        doneLede: 'Your personal data has been deleted, and the account cannot be restored.',
        info: 'Your personal data is deleted at once, and the account cannot be restored.',
        newAccount:
          'You can create a new account with the same email, unless the account was banned.',
      },
      info: 'Your personal data is deleted and your upcoming sessions are cancelled. Your ijazahs stay valid, and payment records are kept without your data as the law requires.',
      lede: 'From the app: Account, then Delete account. If you no longer have the app, request the deletion here.',
      refused: {
        activeEnrollments:
          'You cannot delete your account now because you have ongoing enrollments. You can delete it once they end, or contact support to end them.',
        pendingIjazahRequests:
          'You cannot delete your account now because you have ijazah requests still in progress. You can delete it once Administration has finished them, or contact support.',
      },
      sendCode: 'Send code',
      steps: {
        code: {
          meta: 'then the account is deleted at once',
          title: 'Code and confirmation',
        },
        email: {
          done: 'Code sent',
          meta: 'We send a code to it',
          title: 'Account email',
        },
      },
      title: 'Delete your Ijazah account',
    },
    notFound: {
      text: 'Check the number as printed on the certificate, or scan the QR code again.',
      title: 'No ijazah has this number',
    },
  },
  notifications: {
    push: {
      cancellation_request_accepted: {
        body: 'The session is cancelled by agreement. Open the app for the details.',
        title: 'Your cancellation request was accepted',
      },
      cancellation_request_declined: {
        body: 'The session stands at its scheduled time.',
        title: 'Your cancellation request was declined',
      },
      cancellation_requested: {
        body: 'A cancellation was requested for one of your sessions. Accept or decline before it starts.',
        title: 'Cancellation request',
      },
      payment_confirmed: {
        body: 'The payment gateway confirmed your payment. Open the app to see your enrollment.',
        title: 'Payment confirmed',
      },
      payment_expired: {
        body: 'The time to pay ran out before the payment was completed. Open the app to see your booking.',
        title: 'The time to pay ran out',
      },
      payment_failed: {
        body: 'Your payment did not go through. Try again from the app.',
        title: 'Payment failed',
      },
      session_reminder: {
        body: 'Your session is coming up. Open the app to join on time.',
        title: 'Session reminder',
      },
    },
  },
};
