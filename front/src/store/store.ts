// store.ts - Updated to include group reducer
import { configureStore } from '@reduxjs/toolkit';
import messageReducer from './messageSlice';
import groupReducer from './groupSlice';

export const store = configureStore({
    reducer: {
        messages: messageReducer,
        groups: groupReducer
    }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;