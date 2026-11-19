// B50 T148 (research R-103; the note under T148): Google's identity token through Credential
// Manager, asked for the Web client ID with the server's nonce as the app hands it, so the token's
// `nonce` claim is that value and the server compares it as given. Resolves { idToken, email },
// null when the person closes the sheet, and rejects with a code otherwise; neither the token nor
// the address is ever put in an error. No permission is needed.
package com.ijazah.googleid

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor

class GoogleIdModule : Module() {
  // The callbacks only settle the promise, which is safe from any thread.
  private val direct = Executor { it.run() }

  override fun definition() = ModuleDefinition {
    Name("GoogleId")

    AsyncFunction("signIn") { webClientId: String, nonce: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(ERR_NO_ACTIVITY, "No activity to show the sign-in on.", null)
        return@AsyncFunction
      }
      val option = GetGoogleIdOption.Builder()
        .setServerClientId(webClientId)
        .setNonce(nonce)
        .setFilterByAuthorizedAccounts(false)
        .build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
      CredentialManager.create(activity).getCredentialAsync(
        activity,
        request,
        null,
        direct,
        object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
          override fun onResult(result: GetCredentialResponse) = settle(result, promise)

          override fun onError(e: GetCredentialException) {
            if (e is GetCredentialCancellationException) promise.resolve(null)
            else promise.reject(ERR_FAILED, e.type, null)
          }
        },
      )
    }

    AsyncFunction("signOut") { promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      CredentialManager.create(context).clearCredentialStateAsync(
        ClearCredentialStateRequest(),
        null,
        direct,
        object : CredentialManagerCallback<Void?, ClearCredentialException> {
          override fun onResult(result: Void?) = promise.resolve(null)

          override fun onError(e: ClearCredentialException) =
            promise.reject(ERR_SIGN_OUT_FAILED, e.type, null)
        },
      )
    }
  }

  private fun settle(result: GetCredentialResponse, promise: Promise) {
    val credential = result.credential
    if (
      credential !is CustomCredential ||
      credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
    ) {
      promise.reject(ERR_UNEXPECTED, "Not a Google ID token.", null)
      return
    }
    try {
      val google = GoogleIdTokenCredential.createFrom(credential.data)
      // `id` is the address of the account the person chose.
      promise.resolve(mapOf("idToken" to google.idToken, "email" to google.id))
    } catch (_: GoogleIdTokenParsingException) {
      promise.reject(ERR_UNEXPECTED, "The Google ID token could not be read.", null)
    }
  }

  companion object {
    private const val ERR_NO_ACTIVITY = "ERR_GOOGLE_ID_NO_ACTIVITY"
    private const val ERR_FAILED = "ERR_GOOGLE_ID_FAILED"
    private const val ERR_UNEXPECTED = "ERR_GOOGLE_ID_UNEXPECTED"
    private const val ERR_SIGN_OUT_FAILED = "ERR_GOOGLE_ID_SIGN_OUT_FAILED"
  }
}
