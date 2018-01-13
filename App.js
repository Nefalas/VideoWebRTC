/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 * @flow
 */

import React, { Component } from 'react';
import {
    View,
    StyleSheet
} from 'react-native';
import Janus from "./components/janus/Janus";
import RTCView from "react-native-webrtc/RTCView";

let container = null;

export default class App extends Component<{}> {

    constructor(props) {
        super(props);
        this.state = {
            videoUrl: null
        }
    }

    componentDidMount() {
        container= this;
        let janus = new Janus(container);
        janus.createSession();
    }

    render() {
        return (
            <View style={ styles.container }>
                <RTCView style={ styles.videoView } streamURL={this.state.videoUrl}/>
            </View>
        );
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        backgroundColor: '#ccc'
    },
    videoView: {
        flex: 1,
        backgroundColor: '#ffffff'
    }
});