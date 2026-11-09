<script setup lang="ts">
import { useQueryClient } from "@tanstack/vue-query";
import { ref } from "vue";
import { Notes } from "./notes.js";

const queryClient = useQueryClient();
const title = ref("");
const notes = Notes.useListNotes({ query: {} });
const createNote = Notes.useCreateNote({
  onSuccess: () => {
    title.value = "";

    return queryClient.invalidateQueries();
  },
});
</script>

<template>
  <p v-if="notes.isPending.value">Loading</p>
  <p v-else-if="notes.isError.value" role="alert">{{ notes.error.value?.message }}</p>
  <main v-else>
    <h1>Notes</h1>
    <form @submit.prevent="createNote.mutate({ body: { title } })">
      <input v-model="title" />
      <button type="submit">Add</button>
    </form>
    <p v-if="createNote.isError.value" role="alert">{{ createNote.error.value?.message }}</p>
    <ul>
      <li v-for="note in notes.data.value?.body.items" :key="note.noteId">{{ note.title }}</li>
    </ul>
  </main>
</template>
