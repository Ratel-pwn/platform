<!--
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import activity, { ActivityMessage } from '@hcengineering/activity'
  import { Analytics } from '@hcengineering/analytics'
  import { AttachmentRefInput } from '@hcengineering/attachment-resources'
  import chunter, { ChatMessage, ChunterEvents, ThreadMessage } from '@hcengineering/chunter'
  import { Class, Doc, generateId, getCurrentAccount, Ref, type CommitResult } from '@hcengineering/core'
  import { createQuery, DraftController, draftsStore, getClient, getCurrentWorkspaceUuid } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { createEventDispatcher } from 'svelte'
  import { getObjectId } from '@hcengineering/view-resources'
  import { showPopup, ThrottledCaller } from '@hcengineering/ui'
  import { getSpace, editingMessageStore } from '@hcengineering/activity-resources'
  import { findMentionedReviewAgents, setReviewDemand } from '../../reviewDemand'

  import { getChannelSpace } from '../../utils'
  import ChannelTypingInfo from '../ChannelTypingInfo.svelte'
  import ReviewDemandNamePopup from '../ReviewDemandNamePopup.svelte'

  export let object: Doc
  export let chatMessage: ChatMessage | undefined = undefined
  export let shouldSaveDraft: boolean = true
  export let focusIndex: number = -1
  export let boundary: HTMLElement | undefined = undefined
  export let loading = false
  export let collection: string = 'comments'
  export let autofocus = false
  export let withTypingInfo = false
  export let onKeyDown: ((e: KeyboardEvent) => void) | undefined = undefined
  export let reviewDemandRootId: Ref<ChatMessage> | undefined = undefined
  export let reviewDemandTitle: string | undefined = undefined
  export let reviewDemandInvalid = false

  import { setTyping, clearTyping } from '@hcengineering/presence-resources'

  type MessageDraft = Pick<ChatMessage, '_id' | 'message' | 'attachments'>

  const dispatch = createEventDispatcher()

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const baseClass: Ref<Class<ChatMessage>> = hierarchy.isDerived(object._class, activity.class.ActivityMessage)
    ? chunter.class.ThreadMessage
    : chunter.class.ChatMessage
  const _class: Ref<Class<ChatMessage>> = reviewDemandRootId !== undefined ? chunter.class.ThreadMessage : baseClass
  const createdMessageQuery = createQuery()

  const draftKey = `${getCurrentAccount().uuid}_${getCurrentWorkspaceUuid()}_${object._id}_${reviewDemandRootId ?? 'channel'}_${_class}`
  const draftController = new DraftController<MessageDraft>(draftKey)
  const currentDraft = shouldSaveDraft ? $draftsStore[draftKey] : undefined

  const emptyMessage: Pick<MessageDraft, 'message' | 'attachments'> = {
    message: EmptyMarkup,
    attachments: 0
  }

  let inputRef: AttachmentRefInput
  let currentMessage: MessageDraft = chatMessage ?? currentDraft ?? getDefault()
  let _id = currentMessage._id
  let inputContent = currentMessage.message
  let submissionError: string | undefined

  $: if (currentDraft != null) {
    createdMessageQuery.query(_class, { _id, space: getSpace(object) }, (result: ChatMessage[]) => {
      if (result.length > 0 && _id !== chatMessage?._id) {
        // Ouch we have got comment with same id created already.
        clear()
      }
    })
  } else {
    createdMessageQuery.unsubscribe()
  }

  function clear (): void {
    currentMessage = getDefault()
    _id = currentMessage._id
    inputRef.removeDraft(false)
  }

  function objectChange (draft: MessageDraft, empty: Partial<MessageDraft>): void {
    if (shouldSaveDraft) {
      draftController.save(draft, empty)
    }
  }

  $: objectChange(currentMessage, emptyMessage)

  function getDefault (): MessageDraft {
    return {
      _id: generateId(),
      ...emptyMessage
    }
  }

  const acc = getCurrentAccount()
  const throttle = new ThrottledCaller(500)

  async function deleteTypingInfo (): Promise<void> {
    if (!withTypingInfo) return
    void clearTyping(acc.primarySocialId, object._id)
  }

  async function updateTypingInfo (): Promise<void> {
    if (!withTypingInfo) return

    throttle.call(() => {
      void setTyping(acc.primarySocialId, object._id)
    })
  }

  function onUpdate (event: CustomEvent): void {
    if (!isEmptyMarkup(event.detail.message)) {
      void updateTypingInfo()
    }
    if (!shouldSaveDraft) {
      return
    }
    const { message, attachments } = event.detail
    currentMessage.message = message
    currentMessage.attachments = attachments
  }

  async function handleCreate (event: CustomEvent, _id: Ref<ChatMessage>): Promise<void> {
    const res = await createMessage(event, _id, `chunter.create.${_class} ${object._class}`)

    console.log(`create.${_class} measure`, res.serverTime, res.time)
    const objectId = await getObjectId(object, client.getHierarchy())
    Analytics.handleEvent(ChunterEvents.MessageCreated, { ok: res.result, objectId, objectClass: object._class })
  }

  async function handleEdit (event: CustomEvent): Promise<void> {
    try {
      await editMessage(event)
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageEdited, { ok: true, objectId, objectClass: object._class })
    } catch (err: any) {
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageEdited, { ok: false, objectId, objectClass: object._class })
      Analytics.handleError(err)
      throw err
    }
  }

  async function onMessage (detail: { message: string, attachments: number }): Promise<boolean> {
    loading = true
    submissionError = undefined
    try {
      if (chatMessage === undefined && !(await prepareReviewDemand(detail.message))) return false
      await inputRef.createAttachments()
      const event = new CustomEvent('message', { detail })
      const submittedId = _id
      if (chatMessage !== undefined) {
        await handleEdit(event)
      } else {
        await handleCreate(event, _id)
        await deleteTypingInfo()
      }
      draftController.remove()
      inputRef.removeDraft(false)
      clear()
      dispatch('submit', false)
      if (chatMessage === undefined && reviewDemandRootId === undefined && reviewDemandTitle !== undefined) {
        setReviewDemand({ channelId: object._id, rootId: submittedId, title: reviewDemandTitle })
      }
      return true
    } catch (err: any) {
      // Keep the draft and attachments available when validation or the API fails.
      submissionError = err instanceof Error ? err.message : '发送失败，请重试；草稿已保留。'
      Analytics.handleError(err)
      return false
    } finally {
      loading = false
    }
  }

  async function prepareReviewDemand (message: string): Promise<boolean> {
    if (reviewDemandInvalid) throw new Error('当前需求已失效，请退出后重新选择需求')
    const reviewAgents = reviewDemandRootId === undefined ? await findMentionedReviewAgents(message) : []
    if (reviewAgents.length > 1) {
      throw new Error('请一次只选择一个文档评审 Agent')
    }
    if (reviewDemandRootId === undefined && reviewAgents.length === 1 && reviewAgents[0].name !== '技术评估Agent') {
      throw new Error('请先选择已有需求，再交接给方案Agent或合同Agent')
    }
    if (reviewDemandRootId === undefined && reviewAgents.length === 1 && reviewDemandTitle === undefined) {
      const title = await new Promise<string | undefined>((resolve) => {
        showPopup(ReviewDemandNamePopup, {}, 'center', (value) => resolve(typeof value === 'string' ? value.trim() : undefined))
      })
      if (title === undefined || title.length === 0) {
        return false
      }
      reviewDemandTitle = title
    }
    return true
  }

  async function createMessage (event: CustomEvent, _id: Ref<ChatMessage>, msg: string): Promise<CommitResult> {
    const { message, attachments } = event.detail
    const operations = client.apply(undefined, msg)

    if (_class === chunter.class.ThreadMessage) {
      const parentMessage = object as ActivityMessage
      const attachedTo = reviewDemandRootId ?? parentMessage._id
      const attachedToClass = reviewDemandRootId !== undefined ? chunter.class.ChatMessage : parentMessage._class

      await operations.addCollection<ActivityMessage, ThreadMessage>(
        chunter.class.ThreadMessage,
        reviewDemandRootId !== undefined ? getSpace(object) : parentMessage.space,
        attachedTo,
        attachedToClass,
        'replies',
        {
          message,
          attachments,
          objectClass: object._class,
          objectId: object._id
        },
        _id as Ref<ThreadMessage>
      )
    } else {
      await operations.addCollection<Doc, ChatMessage>(
        _class,
        getSpace(object),
        object._id,
        object._class,
        collection,
        { message, attachments, ...(reviewDemandTitle !== undefined ? { reviewDemandTitle } : {}) },
        _id
      )
    }
    return await operations.commit()
  }

  async function editMessage (event: CustomEvent): Promise<void> {
    if (chatMessage === undefined) {
      return
    }
    const { message, attachments } = event.detail
    await client.update(chatMessage, { message, attachments, editedOn: Date.now() })
  }
  export function submit (): void {
    inputRef.submit()
  }

  function handleKeyDown (event: KeyboardEvent): boolean {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (inputRef.isEmptyDraft() && chatMessage == null) {
        onKeyDown?.(event)
      }
    }

    if (event.key === 'Escape') {
      if ($editingMessageStore === undefined) return false
      event.stopPropagation()
      event.preventDefault()
      editingMessageStore.set(undefined)
    }
    return false
  }
</script>

<AttachmentRefInput
  {focusIndex}
  bind:this={inputRef}
  bind:content={inputContent}
  docId={object._id}
  docClass={object._class}
  {_class}
  space={getChannelSpace(object._class, object._id, object.space)}
  skipAttachmentsPreload={(currentMessage.attachments ?? 0) === 0}
  bind:objectId={_id}
  {shouldSaveDraft}
  {boundary}
  {autofocus}
  submitHandler={onMessage}
  on:update={onUpdate}
  on:focus
  on:blur
  bind:loading
  onKeyDown={handleKeyDown}
/>

{#if submissionError !== undefined}
  <div class="px-4 py-2" role="alert">{submissionError}</div>
{/if}

{#if withTypingInfo}
  <ChannelTypingInfo {object} />
{/if}
