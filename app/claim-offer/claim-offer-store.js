// @flow
import {
  put,
  takeLatest,
  take,
  race,
  call,
  all,
  select,
  takeEvery,
  fork,
} from 'redux-saga/effects'
import { delay } from 'redux-saga'
import { Platform } from 'react-native'
import {
  CLAIM_OFFER_STATUS,
  CLAIM_OFFER_RECEIVED,
  CLAIM_OFFER_SHOWN,
  CLAIM_OFFER_ACCEPTED,
  CLAIM_OFFER_REJECTED,
  SEND_CLAIM_REQUEST,
  CLAIM_REQUEST_SUCCESS,
  CLAIM_REQUEST_FAIL,
  CLAIM_OFFER_IGNORED,
  CLAIM_REQUEST_STATUS,
  ADD_SERIALIZED_CLAIM_OFFER,
  KEY_SERIALIZED_CLAIM_OFFERS,
  SAVE_SERIALIZED_CLAIM_OFFERS_SUCCESS,
  SAVE_SERIALIZED_CLAIM_OFFERS_FAIL,
  ERROR_SAVE_SERIALIZED_CLAIM_OFFERS,
  REMOVE_SERIALIZED_CLAIM_OFFERS_SUCCESS,
  REMOVE_SERIALIZED_CLAIM_OFFERS_FAIL,
  HYDRATE_SERIALIZED_CLAIM_OFFERS_SUCCESS,
  HYDRATE_SERIALIZED_CLAIM_OFFERS_FAIL,
  ERROR_HYDRATE_SERIALIZED_CLAIM_OFFERS,
  ERROR_NO_SERIALIZED_CLAIM_OFFER,
  ERROR_SEND_CLAIM_REQUEST,
} from './type-claim-offer'
import type {
  ClaimOfferStore,
  ClaimOfferAction,
  ClaimOfferShownAction,
  ClaimOfferAcceptedAction,
  ClaimOfferResponse,
  ClaimOfferPayload,
  AddSerializedClaimOfferAction,
  SerializedClaimOffers,
} from './type-claim-offer'
import type {
  AdditionalDataPayload,
  NotificationPayloadInfo,
} from '../push-notification/type-push-notification'
import type { CustomError } from '../common/type-common'
import {
  getAgencyUrl,
  getClaimOffer,
  getUserPairwiseDid,
  getUserOneTimeInfo,
  getAgencyVerificationKey,
  getRemotePairwiseDidAndName,
  getPoolConfig,
  getSerializedClaimOffers,
  getConnection,
  getSerializedClaimOffer,
} from '../store/store-selector'
import type { IndyClaimOffer } from '../bridge/react-native-cxs/type-cxs'
import {
  generateClaimRequest,
  sendMessage,
  getHandleBySerializedConnection,
  getClaimHandleBySerializedClaimOffer,
  serializeClaimOffer,
} from '../bridge/react-native-cxs/RNCxs'
import type { IndyClaimRequest } from '../bridge/react-native-cxs/type-cxs'
import { CLAIM_STORAGE_FAIL, CLAIM_STORAGE_SUCCESS } from '../claim/type-claim'
import { CLAIM_STORAGE_ERROR } from '../services/error/error-code'
import { MESSAGE_TYPE } from '../api/api-constants'
import type { ApiClaimRequest, EdgeClaimRequest } from '../api/type-api'
import type { UserOneTimeInfo } from '../store/user/type-user-store'
import type { Connection } from '../store/type-connection-store'
import { RESET } from '../common/type-common'
import { setItem, getItem, deleteItem } from '../services/secure-storage'

const claimOfferInitialState = {
  vcxSerializedClaimOffers: {},
}

// TODO:PS: data structure for claim offer received should be flat
// It should not have only payload
// Merge payload and payloadInfo
export const claimOfferReceived = (
  payload: AdditionalDataPayload,
  payloadInfo: NotificationPayloadInfo
) => ({
  type: CLAIM_OFFER_RECEIVED,
  payload,
  payloadInfo,
})

// this action is used because we don't want to show claim offer again to user
// we set claim offer status as shown, so another code path doesn't show it
export const claimOfferShown = (uid: string) => ({
  type: CLAIM_OFFER_SHOWN,
  uid,
})

export const claimOfferIgnored = (uid: string) => ({
  type: CLAIM_OFFER_IGNORED,
  uid,
})

export const claimOfferRejected = (uid: string) => ({
  type: CLAIM_OFFER_REJECTED,
  uid,
})

export const sendClaimRequest = (uid: string, payload: ClaimOfferPayload) => ({
  type: SEND_CLAIM_REQUEST,
  uid,
  payload,
})

export const claimRequestSuccess = (uid: string) => ({
  type: CLAIM_REQUEST_SUCCESS,
  uid,
})

export const claimRequestFail = (uid: string, error: CustomError) => ({
  type: CLAIM_REQUEST_FAIL,
  error,
  uid,
})

export const acceptClaimOffer = (uid: string) => ({
  type: CLAIM_OFFER_ACCEPTED,
  uid,
})

export function convertClaimRequestToEdgeClaimRequest(
  claimRequest: ApiClaimRequest
): EdgeClaimRequest {
  const { blinded_ms, schema_seq_no, issuer_did } = claimRequest

  return {
    blinded_ms,
    issuer_did,
    schema_seq_no,
    msg_type: MESSAGE_TYPE.CLAIM_REQUEST,
    // hard coded version as of now, update once versioning is implemented
    version: '0.1',
    to_did: claimRequest.remoteDid,
    from_did: claimRequest.userPairwiseDid,
    tid: '1',
    mid: '1',
  }
}

export function* claimOfferAccepted(
  action: ClaimOfferAcceptedAction
): Generator<*, *, *> {
  if (Platform.OS === 'android') {
    // once we have integrated vcx, then we would remove this saga
    // and only use claimOfferAcceptedVcx
    yield* claimOfferAcceptedVcx(action)

    return
  }

  const claimOfferPayload: ClaimOfferPayload = yield select(
    getClaimOffer,
    action.uid
  )
  const indyClaimOffer: IndyClaimOffer = {
    issuerDid: claimOfferPayload.issuer.did,
    schemaSequenceNumber:
      claimOfferPayload.data.claimDefinitionSchemaSequenceNumber,
  }
  const remoteDid = claimOfferPayload.remotePairwiseDID
  const userPairwiseDid: string | null = yield select(
    getUserPairwiseDid,
    remoteDid
  )

  if (userPairwiseDid) {
    // set status that we are generating and sending claim request
    yield put(sendClaimRequest(action.uid, claimOfferPayload))
    try {
      const agencyUrl: string = yield select(getAgencyUrl)
      const poolConfig: string = yield select(getPoolConfig)
      const messageId: string = action.uid
      const stringifiedClaimRequest: string = yield call(
        generateClaimRequest,
        remoteDid,
        indyClaimOffer,
        poolConfig
      )
      // TODO:KS Add error handling if claim request parse fails
      const parsedClaimRequest: IndyClaimRequest = JSON.parse(
        stringifiedClaimRequest
      )
      const claimRequest = {
        ...parsedClaimRequest,
        remoteDid,
        userPairwiseDid,
      }
      const userOneTimeInfo: UserOneTimeInfo = yield select(getUserOneTimeInfo)
      const agencyVerificationKey: string = yield select(
        getAgencyVerificationKey
      )
      const connection: Connection = yield select(
        getRemotePairwiseDidAndName,
        userPairwiseDid
      )

      const url = `${agencyUrl}/agency/msg`
      try {
        const sendClaimRequestStatus = yield call(sendMessage, {
          url,
          messageType: MESSAGE_TYPE.CLAIM_REQUEST,
          messageReplyId: messageId,
          message: JSON.stringify(
            convertClaimRequestToEdgeClaimRequest(claimRequest)
          ),
          myPairwiseDid: connection.myPairwiseDid,
          myPairwiseVerKey: connection.myPairwiseVerKey,
          myPairwiseAgentDid: connection.myPairwiseAgentDid,
          myPairwiseAgentVerKey: connection.myPairwiseAgentVerKey,
          myOneTimeAgentDid: userOneTimeInfo.myOneTimeAgentDid,
          myOneTimeAgentVerKey: userOneTimeInfo.myOneTimeAgentVerificationKey,
          myOneTimeDid: userOneTimeInfo.myOneTimeDid,
          myOneTimeVerKey: userOneTimeInfo.myOneTimeVerificationKey,
          myAgencyVerKey: agencyVerificationKey,
          myPairwisePeerVerKey: connection.myPairwisePeerVerKey,
          poolConfig,
        })

        // keep the race open b/w success and fail for claim storage
        // until success and fail is fired for same claim offer id
        // for which we are running this saga, i.e. showing waiting pop up
        while (true) {
          const { success, fail } = yield race({
            success: take(CLAIM_STORAGE_SUCCESS),
            fail: take(CLAIM_STORAGE_FAIL),
          })

          if (success) {
            if (success.messageId === action.uid) {
              yield put(claimRequestSuccess(action.uid))
              break
            }
          } else {
            if (fail.messageId === action.uid) {
              yield put(claimRequestFail(action.uid, CLAIM_STORAGE_ERROR()))
              break
            }
          }
        }
      } catch (e) {
        // TODO: Need to know what to do if claim request fails
        // sending claim request failed, what to do now?
        yield put(claimRequestFail(action.uid, e))
      }
    } catch (e) {
      // generation of claim request failed, what to do now?
      yield put(claimRequestFail(action.uid, e))
    }
  } else {
    yield put(
      claimRequestFail(action.uid, {
        code: 'OCS-002',
        message: 'No pairwise connection found',
      })
    )
  }
}

export function* claimOfferAcceptedVcx(
  action: ClaimOfferAcceptedAction
): Generator<*, *, *> {
  // TODO:KS Once vcx is integrated, rename this method to claimOfferAccepted

  const messageId = action.uid
  const claimOfferPayload: ClaimOfferPayload = yield select(
    getClaimOffer,
    messageId
  )
  const remoteDid = claimOfferPayload.remotePairwiseDID
  const [connection]: Connection[] = yield select(getConnection, remoteDid)
  const vcxSerializedClaimOffer: string | null = yield select(
    getSerializedClaimOffer,
    connection.identifier,
    messageId
  )

  if (!vcxSerializedClaimOffer) {
    yield put(
      claimRequestFail(messageId, ERROR_NO_SERIALIZED_CLAIM_OFFER(messageId))
    )

    return
  }

  try {
    yield put(sendClaimRequest(messageId, claimOfferPayload))
    // since these two api calls are independent, we can call them in parallel
    // but result of both calls are needed before we can move on with other logic
    // so we wait here till both calls are done
    const [connectionHandle, claimHandle] = yield all([
      call(getHandleBySerializedConnection, connection.vcxSerializedConnection),
      call(getClaimHandleBySerializedClaimOffer, vcxSerializedClaimOffer),
    ])
    // TODO We don't have any payment handle as of now, so hard code to 1
    const paymentHandle = 1

    yield call(sendClaimRequest, claimHandle, connectionHandle, paymentHandle)

    // since we have sent claim request, state of claim offer in vcx is changed
    // so we need to update stored serialized claim offer in store
    // update serialized state in background
    yield fork(
      saveSerializedClaimOffer,
      claimHandle,
      connection.identifier,
      messageId
    )

    // keep the race open b/w success and fail for claim storage
    // until success and fail is fired for same claim offer id
    // for which we are running this saga, i.e. showing waiting pop up
    while (true) {
      const { success, fail } = yield race({
        success: take(CLAIM_STORAGE_SUCCESS),
        fail: take(CLAIM_STORAGE_FAIL),
      })

      if (success) {
        if (success.messageId === messageId) {
          yield put(claimRequestSuccess(messageId))
          break
        }
      } else {
        if (fail.messageId === messageId) {
          yield put(claimRequestFail(messageId, CLAIM_STORAGE_ERROR()))
          break
        }
      }
    }
  } catch (e) {
    yield put(claimRequestFail(messageId, ERROR_SEND_CLAIM_REQUEST(e.message)))
  }
}

export function* saveSerializedClaimOffer(
  claimHandle: number,
  userDID: string,
  messageId: string
): Generator<*, *, *> {
  try {
    const serializedClaimOffer: string = yield call(
      serializeClaimOffer,
      claimHandle
    )
    yield put(addSerializedClaimOffer(serializedClaimOffer, userDID, messageId))
  } catch (e) {
    // TODO:KS need to think about what happens when serialize call from vcx fails
  }
}

function* watchClaimOfferAccepted(): any {
  yield takeEvery(CLAIM_OFFER_ACCEPTED, claimOfferAccepted)
}

export const addSerializedClaimOffer = (
  serializedClaimOffer: string,
  userDID: string,
  messageId: string
) => ({
  type: ADD_SERIALIZED_CLAIM_OFFER,
  serializedClaimOffer,
  userDID,
  messageId,
})

export function* watchAddSerializedClaimOffer(): any {
  yield takeEvery(ADD_SERIALIZED_CLAIM_OFFER, saveSerializedClaimOffersSaga)
}

export function* saveSerializedClaimOffersSaga(
  action: AddSerializedClaimOfferAction
): Generator<*, *, *> {
  try {
    const serializedClaimOffers = yield select(getSerializedClaimOffers)
    yield call(
      setItem,
      KEY_SERIALIZED_CLAIM_OFFERS,
      JSON.stringify(serializedClaimOffers)
    )
    yield put({ type: SAVE_SERIALIZED_CLAIM_OFFERS_SUCCESS })
  } catch (e) {
    yield put({
      type: SAVE_SERIALIZED_CLAIM_OFFERS_FAIL,
      error: ERROR_SAVE_SERIALIZED_CLAIM_OFFERS(e.message),
    })
  }
}

export function* removePersistedSerializedClaimOffersSaga(): Generator<
  *,
  *,
  *
> {
  try {
    yield call(deleteItem, KEY_SERIALIZED_CLAIM_OFFERS)
    yield put({ type: REMOVE_SERIALIZED_CLAIM_OFFERS_SUCCESS })
  } catch (e) {
    yield put({ type: REMOVE_SERIALIZED_CLAIM_OFFERS_FAIL })
  }
}

export function* hydrateSerializedClaimOffersSaga(): Generator<*, *, *> {
  try {
    const serializedClaimOffersJson = yield call(
      getItem,
      KEY_SERIALIZED_CLAIM_OFFERS
    )
    if (serializedClaimOffersJson) {
      const serializedClaimOffers = JSON.parse(serializedClaimOffersJson)
      yield put(hydrateSerializedClaimOffers(serializedClaimOffers))
    }
  } catch (e) {
    yield put({
      type: HYDRATE_SERIALIZED_CLAIM_OFFERS_FAIL,
      error: ERROR_HYDRATE_SERIALIZED_CLAIM_OFFERS(e.message),
    })
  }
}

export const hydrateSerializedClaimOffers = (
  serializedClaimOffers: SerializedClaimOffers
) => ({
  type: HYDRATE_SERIALIZED_CLAIM_OFFERS_SUCCESS,
  serializedClaimOffers,
})

export function* watchClaimOffer(): Generator<*, *, *> {
  yield all([watchClaimOfferAccepted(), watchAddSerializedClaimOffer()])
}

export default function claimOfferReducer(
  state: ClaimOfferStore = claimOfferInitialState,
  action: ClaimOfferAction
) {
  switch (action.type) {
    case CLAIM_OFFER_RECEIVED:
      return {
        ...state,
        [action.payloadInfo.uid]: {
          ...action.payload,
          ...action.payloadInfo,
          status: CLAIM_OFFER_STATUS.RECEIVED,
          claimRequestStatus: CLAIM_REQUEST_STATUS.NONE,
          error: null,
        },
      }
    case CLAIM_OFFER_SHOWN:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          status: CLAIM_OFFER_STATUS.SHOWN,
        },
      }
    case CLAIM_OFFER_ACCEPTED:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          status: CLAIM_OFFER_STATUS.ACCEPTED,
        },
      }
    case CLAIM_OFFER_IGNORED:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          status: CLAIM_OFFER_STATUS.IGNORED,
        },
      }
    case CLAIM_OFFER_REJECTED:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          status: CLAIM_OFFER_STATUS.REJECTED,
        },
      }
    case SEND_CLAIM_REQUEST:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          claimRequestStatus: CLAIM_REQUEST_STATUS.SENDING_CLAIM_REQUEST,
        },
      }
    case CLAIM_REQUEST_SUCCESS:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          claimRequestStatus: CLAIM_REQUEST_STATUS.CLAIM_REQUEST_SUCCESS,
        },
      }
    case CLAIM_REQUEST_FAIL:
      return {
        ...state,
        [action.uid]: {
          ...state[action.uid],
          claimRequestStatus: CLAIM_REQUEST_STATUS.CLAIM_REQUEST_FAIL,
        },
      }
    case RESET:
      return claimOfferInitialState
    case ADD_SERIALIZED_CLAIM_OFFER:
      return {
        ...state,
        vcxSerializedClaimOffers: {
          ...state.vcxSerializedClaimOffers,
          [action.userDID]: {
            ...state.vcxSerializedClaimOffers[action.userDID],
            [action.messageId]: action.serializedClaimOffer,
          },
        },
      }
    case HYDRATE_SERIALIZED_CLAIM_OFFERS_SUCCESS:
      return {
        ...state,
        vcxSerializedClaimOffers: action.serializedClaimOffers,
      }
    default:
      return state
  }
}
