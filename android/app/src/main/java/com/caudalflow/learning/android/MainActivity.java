package com.caudalflow.learning.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(WorkspaceFilesPlugin.class);
        super.onCreate(state);
    }
}
